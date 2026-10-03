"""Produce the two digit-helper models bundled in public/models.

    digit-helper-mathex.onnx   devansh9837/mathex `models/mathex_v1.h5`, weights copied
                               unchanged into an ONNX graph
    digit-helper-mnist.onnx    ONNX Model Zoo `mnist-12.onnx`, byte for byte

Nothing here trains anything.

    python scripts/model/convert_helpers.py --candidates <dir> --out public/models [--verify]

`<dir>` must contain a clone of mathex named `mathex` and the file `mnist-12.onnx`; see
scripts/model/README.md. `--verify` needs TensorFlow (`pip install tensorflow tf_keras`): it
runs 1,000 images through the original Keras model and through the ONNX copy and reports the
largest difference between their outputs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path

import numpy as np
import onnxruntime as ort

from benchmark_candidates import convert_mathex


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_mathex(root: Path, onnx_path: Path) -> dict:
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
    os.environ["TF_USE_LEGACY_KERAS"] = "1"
    import tf_keras

    models = root / "mathex" / "models"
    keras = tf_keras.models.model_from_json((models / "mathex_v1.json").read_text())
    keras.load_weights(str(models / "mathex_v1.h5"))

    rng = np.random.default_rng(0)
    images = rng.uniform(0, 255, size=(1000, 28, 28, 1)).astype(np.float32)
    images[:500] = (images[:500] > 200) * 255.0  # half black-and-white, like the real inputs

    expected = keras.predict(images, batch_size=250, verbose=0)
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    actual = session.run(None, {"input": images.transpose(0, 3, 1, 2)})[0]
    return {
        "images": len(images),
        "parameters": int(keras.count_params()),
        "largest_output_difference": float(np.abs(expected - actual).max()),
        "same_top_class": int((expected.argmax(1) == actual.argmax(1)).sum()),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--candidates", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    mathex = args.out / "digit-helper-mathex.onnx"
    shutil.copyfile(convert_mathex(args.candidates), mathex)
    mnist = args.out / "digit-helper-mnist.onnx"
    shutil.copyfile(args.candidates / "mnist-12.onnx", mnist)

    report = {
        mathex.name: {"bytes": mathex.stat().st_size, "sha256": sha256(mathex)},
        mnist.name: {"bytes": mnist.stat().st_size, "sha256": sha256(mnist)},
    }
    if args.verify:
        report[mathex.name]["against_keras"] = verify_mathex(args.candidates, mathex)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
