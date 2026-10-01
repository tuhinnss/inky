"""Convert the pre-trained Keras symbol classifier to ONNX. No training happens here.

The upstream model (altynbk/handwritten-math-recognition, MIT) ships as a Keras 3
`.keras` archive. This script copies its weights, unchanged, into an equivalent
ONNX graph so that onnxruntime-web can run it in the browser.

    python scripts/model/convert_model.py --source <clone of upstream repo> --out public/models --verify

`--verify` re-runs the upstream test split through the ONNX model with the upstream
preprocessing code, so the converted file can be checked against the accuracy the
author published (0.9944 on 1,608 held-out images).
"""
from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path

import h5py
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

UPSTREAM_URL = "https://github.com/altynbk/handwritten-math-recognition"
MODEL_FILE = "models/cnn_aug.keras"
OPSET = 13
IR_VERSION = 8  # old enough for every onnxruntime-web release we might pin


def read_keras_archive(path: Path):
    with zipfile.ZipFile(path) as archive:
        config = json.loads(archive.read("config.json"))
        metadata = json.loads(archive.read("metadata.json"))
        with h5py.File(io.BytesIO(archive.read("model.weights.h5")), "r") as weights_file:
            weights = {
                name: [np.asarray(group["vars"][str(i)]) for i in range(len(group["vars"]))]
                for name, group in weights_file["layers"].items()
            }
    return config, metadata, weights


def weight_key(class_prefix: str, index: int) -> str:
    """Keras names saved weight groups conv2d, conv2d_1, ... in layer order."""
    return class_prefix if index == 0 else f"{class_prefix}_{index}"


def build_onnx(config, weights, class_names, metadata) -> onnx.ModelProto:
    nodes, initializers = [], []
    counters = {"conv2d": 0, "batch_normalization": 0, "dense": 0}
    current = "input"

    def add_initializer(name: str, array: np.ndarray) -> str:
        initializers.append(numpy_helper.from_array(np.ascontiguousarray(array, dtype=np.float32), name))
        return name

    def take(prefix: str):
        key = weight_key(prefix, counters[prefix])
        counters[prefix] += 1
        return key, weights[key]

    for layer in config["config"]["layers"]:
        kind, cfg = layer["class_name"], layer["config"]

        if kind == "InputLayer":
            assert cfg["batch_shape"] == [None, 64, 64, 1], cfg["batch_shape"]

        elif kind == "Conv2D":
            assert cfg["padding"] == "same" and cfg["strides"] == [1, 1] and cfg["activation"] == "relu", cfg
            key, (kernel, bias) = take("conv2d")
            # Keras stores kernels as (h, w, in, out); ONNX wants (out, in, h, w).
            w = add_initializer(f"{key}.weight", kernel.transpose(3, 2, 0, 1))
            b = add_initializer(f"{key}.bias", bias)
            pad = cfg["kernel_size"][0] // 2
            nodes.append(helper.make_node("Conv", [current, w, b], [f"{key}.out"], name=key,
                                          kernel_shape=cfg["kernel_size"], pads=[pad] * 4, strides=[1, 1]))
            nodes.append(helper.make_node("Relu", [f"{key}.out"], [f"{key}.relu"], name=f"{key}.relu"))
            current = f"{key}.relu"

        elif kind == "BatchNormalization":
            key, (gamma, beta, mean, variance) = take("batch_normalization")
            inputs = [current] + [add_initializer(f"{key}.{n}", v) for n, v in
                                  (("gamma", gamma), ("beta", beta), ("mean", mean), ("var", variance))]
            nodes.append(helper.make_node("BatchNormalization", inputs, [f"{key}.out"], name=key,
                                          epsilon=float(cfg["epsilon"])))
            current = f"{key}.out"

        elif kind == "MaxPooling2D":
            assert cfg["padding"] == "valid", cfg
            name = f"pool_{len(nodes)}"
            nodes.append(helper.make_node("MaxPool", [current], [name], name=name,
                                          kernel_shape=cfg["pool_size"], strides=cfg["strides"]))
            current = name

        elif kind == "GlobalAveragePooling2D":
            nodes.append(helper.make_node("GlobalAveragePool", [current], ["gap"], name="gap"))
            nodes.append(helper.make_node("Flatten", ["gap"], ["features"], name="flatten", axis=1))
            current = "features"

        elif kind == "Dropout":
            pass  # identity at inference time

        elif kind == "Dense":
            assert cfg["activation"] == "softmax" and cfg["units"] == len(class_names), cfg
            key, (kernel, bias) = take("dense")
            w = add_initializer(f"{key}.weight", kernel)  # (in, out): Gemm computes x @ W + b
            b = add_initializer(f"{key}.bias", bias)
            nodes.append(helper.make_node("Gemm", [current, w, b], ["logits"], name=key))
            nodes.append(helper.make_node("Softmax", ["logits"], ["probabilities"], name="softmax", axis=1))
            current = "probabilities"

        else:
            raise ValueError(f"Unsupported layer type: {kind}")

    graph = helper.make_graph(
        nodes,
        "calcink-symbol-classifier",
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, ["batch", 1, 64, 64])],
        [helper.make_tensor_value_info("probabilities", TensorProto.FLOAT, ["batch", len(class_names)])],
        initializers,
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", OPSET)],
                              producer_name="calcink/scripts/model/convert_model.py")
    model.ir_version = IR_VERSION
    for key, value in metadata.items():
        entry = model.metadata_props.add()
        entry.key, entry.value = key, value
    onnx.checker.check_model(model)
    return model


def upstream_commit(source: Path) -> str:
    try:
        return subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def verify(source: Path, onnx_path: Path) -> dict:
    """Run the upstream held-out test split through the converted model."""
    import onnxruntime as ort

    sys.path.insert(0, str(source))
    from src.data import load_dataset, split_data  # upstream preprocessing, used as-is

    X, y, class_names, stats = load_dataset(str(source / "data" / "handwritten_dataset"))
    X_test, y_test = split_data(X, y, seed=42)["test"]
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    probabilities = session.run(None, {"input": X_test.transpose(0, 3, 1, 2)})[0]
    predictions = probabilities.argmax(axis=1)
    correct = int((predictions == y_test).sum())

    per_class = {}
    for index, name in enumerate(class_names):
        mask = y_test == index
        per_class[name] = {"n": int(mask.sum()), "correct": int((predictions[mask] == index).sum())}
    return {
        "test_images": int(len(y_test)),
        "correct": correct,
        "accuracy": correct / len(y_test),
        "dataset_kept": stats["kept"],
        "per_class": per_class,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, required=True, help="local clone of the upstream repository")
    parser.add_argument("--out", type=Path, required=True, help="output directory for the .onnx and labels")
    parser.add_argument("--verify", action="store_true", help="reproduce the upstream test accuracy")
    args = parser.parse_args()

    config, keras_meta, weights = read_keras_archive(args.source / MODEL_FILE)
    class_names = json.loads((args.source / "models" / "meta.json").read_text())["class_names"]
    commit = upstream_commit(args.source)

    model = build_onnx(config, weights, class_names, {
        "source": UPSTREAM_URL,
        "source_commit": commit,
        "source_file": MODEL_FILE,
        "license": "MIT",
        "keras_version": keras_meta["keras_version"],
        "class_names": json.dumps(class_names),
    })

    args.out.mkdir(parents=True, exist_ok=True)
    onnx_path = args.out / "symbol-classifier.onnx"
    onnx.save(model, onnx_path)
    parameters = sum(int(np.prod(t.dims)) for t in model.graph.initializer)
    print(f"wrote {onnx_path} ({onnx_path.stat().st_size / 1024:.0f} KB, {parameters:,} parameters)")
    print(f"upstream commit {commit}, classes {class_names}")

    if args.verify:
        report = verify(args.source, onnx_path)
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
