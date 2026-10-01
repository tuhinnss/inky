"""Evaluate Sagyam/hesv-api's 19-class MobileNetV2 on the same benchmark set.

Kept apart from benchmark_candidates.py because it needs TensorFlow: the model is a
159-layer Keras 2 graph, and running it in Keras directly was quicker and less error-prone
than hand-converting it to ONNX for a model we did not end up choosing.

    pip install tensorflow tf_keras onnx onnxruntime pillow opencv-python-headless scikit-learn
    python scripts/model/benchmark_mobilenet.py --candidates <dir>

`<dir>` must contain shallow clones named `altynbk` and `hesv`.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_USE_LEGACY_KERAS"] = "1"

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import tensorflow as tf  # noqa: E402
import tf_keras  # noqa: E402

from benchmark_candidates import VOCAB, bbox, ink_mask, load_test_split  # noqa: E402

# Output order of the model (hesv-api majorProject/helper/linear_detector.py).
CLASSES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
           "add", "dec", "div", "eq", "mul", "sub", "x", "y", "z"]


def rgb(path: Path) -> np.ndarray:
    """Black ink on white, three channels, uint8: what the hesv pipeline feeds its model."""
    gray = 255 - ink_mask(path)
    return np.repeat(gray[..., None], 3, axis=2)


def prep_whole(path):
    return cv2.resize(rgb(path), (100, 100), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255


def prep_padded(path, padding=50):
    """hesv inference path: crop to the symbol, add 50 px of white, resize to 100x100."""
    image = rgb(path)
    y0, y1, x0, x1 = bbox(255 - image[..., 0])
    padded = cv2.copyMakeBorder(image[y0:y1, x0:x1], padding, padding, padding, padding,
                                cv2.BORDER_CONSTANT, value=(255, 255, 255))
    return cv2.resize(padded, (100, 100), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--candidates", type=Path, required=True)
    root = parser.parse_args().candidates

    model = tf_keras.models.load_model(str(root / "hesv" / "models" / "19_class.h5"), compile=False)
    paths, y = load_test_split(root / "altynbk")
    to_vocab = np.array([VOCAB.index(c) if c in VOCAB else -1 for c in CLASSES])

    variants = []
    for name, prep in (("whole-frame", prep_whole), ("bbox+50px", prep_padded)):
        probabilities = model.predict(np.stack([prep(p) for p in paths]), batch_size=64, verbose=0)
        correct = to_vocab[probabilities.argmax(axis=1)] == y
        variants.append({
            "preprocessing_variant": name,
            "accuracy_on_full_vocabulary": float(correct.mean()),
            "digit_accuracy": float(correct[y < 10].mean()),
            "operator_accuracy": float(correct[y >= 10].mean()),
        })

    sample = tf.constant(np.stack([prep_whole(p) for p in paths[:8]]))
    infer = tf.function(lambda x: model(x, training=False))
    infer(sample)
    times = []
    for _ in range(30):
        start = time.perf_counter()
        infer(sample)
        times.append((time.perf_counter() - start) * 1000)

    print(json.dumps({
        "model": "Sagyam hesv-api 19_class.h5 (MobileNetV2)",
        "parameters": int(model.count_params()),
        "float32_mb": round(model.count_params() * 4 / 1e6, 1),
        "tensorflow_ms_per_8_symbols": round(float(np.median(times)), 1),
        "variants": variants,
    }, indent=2))


if __name__ == "__main__":
    main()
