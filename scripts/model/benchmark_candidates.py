"""Cross-evaluate the candidate classifiers on one common set of canvas-drawn symbols.

This produced the comparison table in docs/ARCHITECTURE.md. It is research tooling, not
part of the app.

Benchmark set: the 1,608-image held-out test split of altynbk/handwritten-math-recognition
(digits plus add / sub / mul / div / eq, drawn on a canvas). It is in-distribution for
that model and not for the others, and the kbss0000 model appears to have been trained on
overlapping images, so read the numbers as indicative rather than as a fair leaderboard.

Each alternative is fed through its own documented preprocessing. Where the upstream docs
are ambiguous, several variants are tried and the best one is reported, so that an
alternative is never marked down for a preprocessing mismatch of our making.

    python scripts/model/benchmark_candidates.py --candidates <dir>

`<dir>` must contain shallow clones named `altynbk`, `kbss` and `mathex`, plus
`mnist-12.onnx` and the converted `symbol-classifier.onnx`. See scripts/model/README.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import cv2
import h5py
import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper, numpy_helper
from PIL import Image
from sklearn.model_selection import train_test_split

VOCAB = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "add", "div", "eq", "mul", "sub"]
DIGITS = VOCAB[:10]


# ---------------------------------------------------------------- benchmark set
def load_test_split(altynbk: Path):
    """Same files, same order and same split as upstream `load_dataset` + `split_data`."""
    sys.path.insert(0, str(altynbk))
    from src.data import IMG_EXTS, preprocess

    data_dir = altynbk / "data" / "handwritten_dataset"
    class_names = sorted(d for d in os.listdir(data_dir) if (data_dir / d).is_dir())
    assert class_names == VOCAB, class_names

    seen, conflicts, paths, labels = {}, set(), [], []
    for idx, cls in enumerate(class_names):
        for fname in sorted(os.listdir(data_dir / cls)):
            if not fname.lower().endswith(IMG_EXTS):
                continue
            with Image.open(data_dir / cls / fname) as im:
                arr = preprocess(im)
            key = hashlib.md5((arr * 255).round().astype("uint8").tobytes()).hexdigest()
            if key in seen:
                if labels[seen[key]] != idx:
                    conflicts.add(key)
                continue
            seen[key] = len(paths)
            paths.append(data_dir / cls / fname)
            labels.append(idx)

    keep = [i for i, k in enumerate(seen) if k not in conflicts]
    paths = [paths[i] for i in keep]
    labels = np.array([labels[i] for i in keep])
    _, test_idx = train_test_split(np.arange(len(paths)), test_size=0.2, random_state=42, stratify=labels)
    return [paths[i] for i in test_idx], labels[test_idx]


def ink_mask(path: Path) -> np.ndarray:
    """uint8 image at the file's native resolution: ink = 255, background = 0."""
    from src.data import to_gray_array

    with Image.open(path) as im:
        gray = to_gray_array(im)
    return ((1.0 - gray) * 255).astype(np.uint8)


def bbox(mask: np.ndarray, thresh: int = 64):
    ys, xs = np.where(mask > thresh)
    if len(ys) == 0:
        return 0, mask.shape[0], 0, mask.shape[1]
    return ys.min(), ys.max() + 1, xs.min(), xs.max() + 1


# ------------------------------------------------------- per-model preprocessing
def prep_altynbk(path):
    from src.data import preprocess

    with Image.open(path) as im:
        return preprocess(im).transpose(2, 0, 1)


def prep_kbss(path, crop: bool):
    """Otsu inverse threshold, plain resize to 32x32, /255 (kbss inference_utils.py)."""
    gray = 255 - ink_mask(path)
    if crop:
        y0, y1, x0, x1 = bbox(255 - gray)
        pad = 5
        gray = gray[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad]
    binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    return (cv2.resize(binary, (32, 32)) / 255.0).astype(np.float32)[None]


def prep_mathex(path, scale: float):
    """Invert, threshold at 127, crop bbox (+10 px), plain resize to 28x28 (mathex/segmentation.py)."""
    mask = cv2.threshold(ink_mask(path), 127, 255, cv2.THRESH_BINARY)[1]
    y0, y1, x0, x1 = bbox(mask)
    crop = mask[y0:min(y1 + 10, mask.shape[0]), x0:min(x1 + 10, mask.shape[1])]
    return (cv2.resize(crop, (28, 28)).astype(np.float32) * scale)[None]


def prep_mnist(path, scale: float):
    """Classic MNIST framing: fit the ink in 20x20, centre it by centre of mass in 28x28."""
    mask = ink_mask(path)
    y0, y1, x0, x1 = bbox(mask)
    crop = mask[y0:y1, x0:x1].astype(np.float32)
    h, w = crop.shape
    factor = 20.0 / max(h, w)
    nh, nw = max(1, round(h * factor)), max(1, round(w * factor))
    small = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((28, 28), dtype=np.float32)
    total = small.sum() or 1.0
    cy = (np.arange(nh)[:, None] * small).sum() / total
    cx = (np.arange(nw)[None, :] * small).sum() / total
    oy = int(np.clip(round(13.5 - cy), 0, 28 - nh))
    ox = int(np.clip(round(13.5 - cx), 0, 28 - nw))
    canvas[oy:oy + nh, ox:ox + nw] = small
    return (canvas / 255.0 * scale)[None]


# ------------------------------------- Keras 2 Sequential .h5 -> ONNX (alternatives)
def sequential_to_onnx(layers, weights, input_hw, name):
    """`layers` is a list of (kind, params); conv and dense layers consume `weights` in order."""
    nodes, inits, current, w_iter = [], [], "input", iter(weights)
    classes = 0

    def init(tag, arr):
        inits.append(numpy_helper.from_array(np.ascontiguousarray(arr, dtype=np.float32), tag))
        return tag

    for i, (kind, p) in enumerate(layers):
        out = f"n{i}"
        if kind == "conv":
            kernel, bias = next(w_iter)
            k = kernel.shape[0]
            pads = [k // 2] * 4 if p["padding"] == "same" else [0] * 4
            nodes.append(helper.make_node(
                "Conv", [current, init(f"w{i}", kernel.transpose(3, 2, 0, 1)), init(f"b{i}", bias)],
                [out + "c"], kernel_shape=[k, k], pads=pads))
            nodes.append(helper.make_node("Relu", [out + "c"], [out]))
        elif kind == "pool":
            nodes.append(helper.make_node("MaxPool", [current], [out], kernel_shape=[2, 2], strides=[2, 2]))
        elif kind == "flatten":
            # Keras flattens NHWC; restore that order so the dense weights line up.
            nodes.append(helper.make_node("Transpose", [current], [out + "t"], perm=[0, 2, 3, 1]))
            nodes.append(helper.make_node("Flatten", [out + "t"], [out], axis=1))
        elif kind == "dense":
            kernel, bias = next(w_iter)
            classes = kernel.shape[1]
            nodes.append(helper.make_node("Gemm", [current, init(f"w{i}", kernel), init(f"b{i}", bias)], [out + "g"]))
            if p["activation"] == "relu":
                nodes.append(helper.make_node("Relu", [out + "g"], [out]))
            else:
                nodes.append(helper.make_node("Softmax", [out + "g"], [out], axis=1))
        current = out

    nodes[-1].output[0] = "probabilities"
    graph = helper.make_graph(
        nodes, name,
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, ["batch", 1, *input_hw])],
        [helper.make_tensor_value_info("probabilities", TensorProto.FLOAT, ["batch", classes])],
        inits)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 8
    onnx.checker.check_model(model)
    return model


def convert_kbss(root: Path) -> Path:
    names = ("conv1", "conv2", "conv3", "fc1", "fc2", "fc3")
    with h5py.File(root / "kbss" / "data" / "models" / "model.h5", "r") as f:
        g = f["model_weights"]
        weights = [(np.asarray(g[n][n]["kernel:0"]), np.asarray(g[n][n]["bias:0"])) for n in names]
    layers = ([("conv", {"padding": "same"}), ("pool", {})] * 3 + [("flatten", {})]
              + [("dense", {"activation": "relu"})] * 2 + [("dense", {"activation": "softmax"})])
    out = root / "alt-kbss.onnx"
    onnx.save(sequential_to_onnx(layers, weights, (32, 32), "kbss"), out)
    return out


def convert_mathex(root: Path) -> Path:
    names = ("conv2d_2", "conv2d_3", "dense_3", "dense_4", "dense_5")
    with h5py.File(root / "mathex" / "models" / "mathex_v1.h5", "r") as f:
        weights = [(np.asarray(f[n][n]["kernel:0"]), np.asarray(f[n][n]["bias:0"])) for n in names]
    layers = ([("conv", {"padding": "valid"}), ("pool", {})] * 2 + [("flatten", {})]
              + [("dense", {"activation": "relu"})] * 2 + [("dense", {"activation": "softmax"})])
    out = root / "alt-mathex.onnx"
    onnx.save(sequential_to_onnx(layers, weights, (28, 28), "mathex"), out)
    return out


# ------------------------------------------------------------------- evaluation
def run(session, batch, batched=True):
    name = session.get_inputs()[0].name
    if batched:
        return session.run(None, {name: batch})[0]
    return np.concatenate([session.run(None, {name: batch[i:i + 1]})[0] for i in range(len(batch))])


def evaluate(label, onnx_path, prep_variants, class_map, paths, y, batched=True):
    """`class_map[i]` is the benchmark class that model output `i` stands for, or any other string."""
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    session = ort.InferenceSession(str(onnx_path), options, providers=["CPUExecutionProvider"])
    supported = sorted({VOCAB.index(c) for c in class_map if c in VOCAB})
    in_scope = np.isin(y, supported)
    to_vocab = np.array([VOCAB.index(c) if c in VOCAB else -1 for c in class_map])

    best, best_batch = None, None
    for variant, prep in prep_variants.items():
        batch = np.stack([prep(p) for p in paths]).astype(np.float32)
        correct = to_vocab[run(session, batch, batched).argmax(axis=1)] == y
        operators = in_scope & (y >= 10)
        result = {
            "preprocessing_variant": variant,
            "accuracy_on_supported_classes": float(correct[in_scope].mean()),
            "accuracy_on_full_vocabulary": float(correct.mean()),
            "digit_accuracy": float(correct[y < 10].mean()),
            "operator_accuracy": float(correct[operators].mean()) if operators.any() else None,
        }
        if best is None or result["accuracy_on_supported_classes"] > best["accuracy_on_supported_classes"]:
            best, best_batch = result, batch

    # Latency for 8 symbols (one short equation): single thread, median of 200 runs.
    sample = best_batch[:8]
    for _ in range(20):
        run(session, sample, batched)
    times = []
    for _ in range(200):
        start = time.perf_counter()
        run(session, sample, batched)
        times.append((time.perf_counter() - start) * 1000)

    model = onnx.load(onnx_path)
    return {
        "model": label,
        **best,
        "onnx_kb": round(Path(onnx_path).stat().st_size / 1024, 1),
        "parameters": int(sum(np.prod(t.dims) for t in model.graph.initializer)),
        "supported_classes": [VOCAB[i] for i in supported],
        "native_ms_per_8_symbols": round(float(np.median(times)), 3),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--candidates", type=Path, required=True)
    root = parser.parse_args().candidates

    paths, y = load_test_split(root / "altynbk")
    print(f"benchmark: {len(paths)} images, {len(VOCAB)} classes", file=sys.stderr)

    results = [
        evaluate("altynbk cnn_aug", root / "symbol-classifier.onnx", {"upstream": prep_altynbk}, VOCAB, paths, y),
        evaluate("kbss0000 model.h5", convert_kbss(root),
                 {"whole-frame": lambda p: prep_kbss(p, False), "bbox-crop": lambda p: prep_kbss(p, True)},
                 DIGITS + ["add", "div", "mul", "sub"], paths, y),
        evaluate("devansh9837 mathex_v1.h5", convert_mathex(root),
                 {"0-255": lambda p: prep_mathex(p, 1.0), "0-1": lambda p: prep_mathex(p, 1 / 255)},
                 DIGITS + ["sub", "add", "mul", "variable"], paths, y),
        evaluate("ONNX Zoo mnist-12", root / "mnist-12.onnx",
                 {"0-1": lambda p: prep_mnist(p, 1.0), "0-255": lambda p: prep_mnist(p, 255.0)},
                 DIGITS, paths, y, batched=False),
    ]
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
