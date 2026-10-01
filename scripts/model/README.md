# Model tooling

Python scripts that produced the bundled model and the comparison in
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md). They are not needed to build or run the app.
No script here trains anything.

| Script                    | Purpose                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `convert_model.py`        | Copies the upstream Keras weights into `public/models/symbol-classifier.onnx` and checks the result |
| `benchmark_candidates.py` | Runs four candidate models over one common test set                                                 |
| `benchmark_mobilenet.py`  | Same test set for the fifth candidate, which needs TensorFlow                                       |

## Reproducing the bundled model

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r scripts/model/requirements.txt

git clone https://github.com/altynbk/handwritten-math-recognition candidates/altynbk
git -C candidates/altynbk checkout 3d91c0c503a596b4efbf35da36cf00e931cc0928

python scripts/model/convert_model.py --source candidates/altynbk --out public/models --verify
```

`--verify` feeds the upstream held-out test split through the converted model using the upstream
preprocessing code. Expected output: `"correct": 1599` of `"test_images": 1608`, an accuracy of
0.9944029850746269, which is the figure in the upstream `results/metrics.json`. Matching it to
the last digit is the evidence that the conversion changed nothing.

## Reproducing the comparison

```bash
git clone https://github.com/kbss0000/Handwritten-Equation-Solver candidates/kbss
git -C candidates/kbss checkout 55e3a065e5a79b320dcfffca4a770d3fffd43cd7
git clone https://github.com/devansh9837/mathex candidates/mathex
git -C candidates/mathex checkout 7341d9e95309f4d427514dde878d5557a4206e4a
curl -L -o candidates/mnist-12.onnx https://huggingface.co/onnxmodelzoo/mnist-12/resolve/main/mnist-12.onnx
cp public/models/symbol-classifier.onnx candidates/

python scripts/model/benchmark_candidates.py --candidates candidates
```

For the MobileNetV2 candidate, in a separate environment:

```bash
pip install tensorflow tf_keras onnx onnxruntime pillow opencv-python-headless scikit-learn
git clone https://github.com/Sagyam/hesv-api candidates/hesv
git -C candidates/hesv checkout 9ec655ac96b8523461f60d86d08bfe95989bc8d8

python scripts/model/benchmark_mobilenet.py --candidates candidates
```

`candidates/` is ignored by git.
