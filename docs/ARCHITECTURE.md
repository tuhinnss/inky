# CalcInk architecture

This document explains how CalcInk is built and why. It grows with the code: each section is
written when the part it describes lands.

- [1. Model selection](#1-model-selection)

## 1. Model selection

### What the model has to do

The problem statement asks for recognition of 16 symbols (`0`–`9`, `+`, `−`, `×`, `÷`, `.`, `=`),
powered by an existing open-source pre-trained model that runs entirely in the browser. From that
and from the grading rubric we derived five requirements:

1. **Coverage.** As many of the 16 symbols as possible come from the model itself.
2. **Permissive licence.** MIT, Apache-2.0 or BSD, verified from the licence file in the source
   repository rather than from a badge or a description.
3. **Small.** The model is precached for offline use, so every megabyte is paid on first load.
4. **Fast on CPU.** It runs under WebAssembly in a worker. An equation of about eight symbols
   should be classified in well under 100 ms.
5. **Accurate on canvas ink.** Our input is strokes drawn with a mouse, finger or stylus. That is
   not the same distribution as scanned paper, and models trained on one do not automatically work
   on the other.

### Approach: classify symbols, not whole expressions

There are two families of model for this task. End-to-end models take an image of a whole
expression and emit LaTeX. Symbol classifiers take one isolated symbol and emit a label, leaving
segmentation and ordering to the application.

We chose a symbol classifier. Our ink is stored as vector strokes with known positions, so the
hard part of the end-to-end problem (finding and ordering symbols in a bitmap) is something we can
do exactly, with geometry, for free. The expressions are a flat, one-line grammar with no
fractions or exponents, so we do not need a model to recover two-dimensional structure. And a
classifier's output is a probability per symbol, which is what the confidence indicator and the
re-evaluation cache both need. The end-to-end models we found (TrOCR-based math recognisers and
image-to-LaTeX transformers) are also autoregressive encoder–decoders that are far larger than a
small CNN, emit LaTeX that would need a second parser, and in several cases carry non-commercial
licences. We did not evaluate them further.

### Candidates

We searched Hugging Face, GitHub, the ONNX Model Zoo and Kaggle, kept every candidate that shipped
weights under a permissive licence, and measured them ourselves.

|                                 | Chosen: **altynbk** `cnn_aug`                                                                   | **Sagyam** `19_class`                                 | **kbss0000**                                                                                    | **mathex**                                                  | **ONNX Zoo** `mnist-12`                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Source                          | [altynbk/handwritten-math-recognition](https://github.com/altynbk/handwritten-math-recognition) | [Sagyam/hesv-api](https://github.com/Sagyam/hesv-api) | [kbss0000/Handwritten-Equation-Solver](https://github.com/kbss0000/Handwritten-Equation-Solver) | [devansh9837/mathex](https://github.com/devansh9837/mathex) | [onnx/models](https://huggingface.co/onnxmodelzoo/mnist-12) |
| Licence                         | MIT                                                                                             | MIT                                                   | MIT                                                                                             | MIT                                                         | MIT                                                         |
| Architecture                    | 4 × (Conv 3×3, BatchNorm, MaxPool), global average pool, dense                                  | MobileNetV2 backbone, dense 1024, dense               | 3 × (Conv 3×3, MaxPool), 3 dense                                                                | 2 × (Conv, MaxPool), 3 dense                                | 2 × (Conv, MaxPool), 1 dense                                |
| Parameters                      | 393,615                                                                                         | 3,594,323                                             | 162,418                                                                                         | 60,137                                                      | 5,998                                                       |
| Input                           | 64×64 grey                                                                                      | 100×100 RGB                                           | 32×32 grey                                                                                      | 28×28 grey                                                  | 28×28 grey                                                  |
| Our symbols covered             | **15 of 16** (all but `.`)                                                                      | **16 of 16**, plus `x y z`                            | 14 (no `=`, `.`)                                                                                | 13 (no `÷`, `=`, `.`)                                       | 10 (digits only)                                            |
| Size as ONNX                    | **1.54 MB**                                                                                     | 14.4 MB ¹                                             | 0.64 MB                                                                                         | 0.24 MB                                                     | 0.03 MB                                                     |
| WASM latency, 1 symbol ²        | 3.7 ms                                                                                          | not measured ¹                                        | 1.3 ms                                                                                          | 0.6 ms                                                      | 0.6 ms                                                      |
| WASM latency, 8 symbols ²       | 29 ms                                                                                           | not measured ¹                                        | 12 ms                                                                                           | 4.3 ms                                                      | 4.5 ms ³                                                    |
| Accuracy claimed by author      | 99.44%                                                                                          | none published                                        | "~95%"                                                                                          | 96.67%                                                      | 98.9% on MNIST                                              |
| **Accuracy on our benchmark ⁴** | **99.4%**                                                                                       | 98.2%                                                 | 84.5%                                                                                           | 64.7%                                                       | 57.4%                                                       |
| … digits only                   | 99.4%                                                                                           | 97.5%                                                 | 99.4% ⁵                                                                                         | 72.7%                                                       | 91.3%                                                       |
| … operators it supports         | 99.5%                                                                                           | 99.3%                                                 | 74.5%                                                                                           | 86.2%                                                       | n/a                                                         |

¹ Parameters × 4 bytes. We did not convert this model to ONNX, so there is no WASM timing. Its
compute per symbol is of the same order as the chosen model (roughly 60 M multiply-adds at
100×100, scaled from MobileNetV2's published figure at 224×224, against 57.8 M for the chosen
model), so we would expect similar latency at nine times the download.

² `onnxruntime-web` 1.30.0, WASM backend with SIMD, one thread, median of 100 runs after warm-up,
on an Intel Core i5-12450HX under Node 22. This is the same WebAssembly binary the browser loads.

³ This model has a fixed batch size of one, so eight symbols are eight separate calls.

⁴ The benchmark is the 1,608-image held-out test split of the altynbk repository: canvas-drawn
digits and operators, 15 classes. A symbol the model has no class for counts as wrong, which is
why digit-only models score low on the headline row. Each alternative was run through its own
documented preprocessing, and where its documentation was ambiguous we tried the plausible
variants and kept the best. **This benchmark favours the chosen model**, because it comes from
that model's own data. We use it because it is the closest available match to our real input,
strokes drawn on a canvas, and treat the gaps as indicative rather than exact.

⁵ Identical to the chosen model's digit score, which suggests this model was trained on images
that overlap the benchmark. Its digit figure is therefore optimistic. The same caution applies to
the Sagyam model: it was trained on the dataset the benchmark is drawn from, with a split we do
not know.

Three further candidates were rejected before measurement:

- **[Sagyam/Handwritten-Optical-Character-Recognition](https://github.com/Sagyam/Handwritten-Optical-Character-Recognition)**
  ships a ready-made TensorFlow.js model for exactly this task, but under GPL-3.0.
- **[MaciejCaputa/handwritten-mathematics-recogniser](https://github.com/MaciejCaputa/handwritten-mathematics-recogniser)**
  (MIT) is a two-layer perceptron whose weights are a 14.7 MB TypeScript literal. It has no `÷` or
  `=` class and the project has been unmaintained since 2018.
- **`TGrote11/Handwriting_Math_Classification`** on Hugging Face is a vision transformer with
  87.5 M parameters, and its model card declares no licence.

### Decision

We bundle **altynbk `cnn_aug`**, converted to ONNX.

- **Coverage.** It is the only small model that has both `÷` and `=`. It covers 15 of 16 symbols.
- **Accuracy.** It scored highest on the benchmark, and the margin over the general-purpose
  alternatives is large for operators, which is where digit-centric models are weakest.
- **Robustness.** The author trained it twice and published both results. The copy trained with
  augmentation (rotation, pen thickness, occlusion, noise) keeps 98.4% on perturbed test images
  where the unaugmented copy drops to 71.2%. We ship the augmented one. Pen thickness is exactly
  the variation a stroke-width slider introduces.
- **Size and speed.** 1.54 MB and 29 ms for a whole equation. The faster candidates are faster
  because they see less: 28×28 input cannot hold the two dots of a `÷`.
- **Domain match.** Its training images were drawn on an HTML canvas, like ours.

The runner-up is **Sagyam `19_class`**. It covers all 16 symbols and has the cleanest provenance of
any candidate (see below). We did not choose it because it is nine times larger and scored lower,
and because its one extra class, the decimal point, is better handled by geometry in any case.

### The decimal point

No small candidate has a `.` class, and we would not rely on one if it did. Every classifier here
crops a symbol to its bounding box and scales it to fill the input. For a decimal point that
discards the only thing that identifies it: that it is tiny and sits on the baseline. After
normalisation a dot is a filled blob indistinguishable from a small `0`.

So `.` is decided before the model is consulted, from the stroke's size relative to the line and
its vertical position. The other 15 symbols are classified by the model. Section 3 (to come)
describes how geometry and model output are combined for the remaining ambiguous cases.

### Provenance and licence check

We read the licence files ourselves. Two things are worth stating plainly.

**The weights are MIT-licensed.** The upstream repository has an MIT `LICENSE` file, copyright
Altynbek Kabiyev, reproduced in [`public/models/LICENSE.txt`](../public/models/LICENSE.txt).

**The training data is not what the upstream README says it is.** The README describes a
"self-collected dataset". The image files in that repository have the same names, class folders
and stray metadata file as the Kaggle dataset
[Handwritten Math Symbols](https://www.kaggle.com/datasets/sagyamthapa/handwritten-math-symbols)
by Sagyam Thapa, which Kaggle lists under **GPL-2**. We conclude the model was trained on a subset
of that dataset.

What this means for us: we redistribute the weights, which their author released under MIT, and
none of the images. Whether weights inherit the licence of their training data is not legally
settled. We consider the risk acceptable for this project and record it here rather than leave it
to be discovered. The same question applies to the alternatives: the other operator-capable
models were trained on this dataset or on data derived from CROHME, whose licence we did not
verify.

If a clean lineage is ever required, the swap is to Sagyam `19_class`: the dataset's own author,
licensing his own model under MIT. The model is loaded through an adapter that isolates the input
size, label list and normalisation, so the change would be confined to that adapter and the model
file.

### Conversion to ONNX

The upstream model is a Keras 3 `.keras` archive. `onnxruntime-web` needs ONNX.
[`scripts/model/convert_model.py`](../scripts/model/convert_model.py) reads the weight tensors out
of the archive and writes them, unchanged, into an equivalent ONNX graph. **No training,
fine-tuning or quantisation takes place.**

We built the graph by hand with `onnx.helper` instead of using a generic converter. The network is
sixteen layers, so this is about sixty lines, it has no dependency on TensorFlow, and every
operator in the output is one we chose. The 4.8 MB archive becomes a 1.54 MB file because the
archive also stores the optimiser's state, which inference does not need.

To prove the conversion is faithful, the script runs the upstream test split through the ONNX
model using the upstream preprocessing code. It classifies 1,599 of 1,608 images correctly:
0.9944029850746269, identical to the figure in the upstream `results/metrics.json`.

### What the model expects

Measured over all 8,036 upstream images after upstream preprocessing, to calibrate our own
rasteriser:

| Property     | Value                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| Tensor       | `[N, 1, 64, 64]` float32, ink = 1.0, background = 0.0                            |
| Framing      | Symbol cropped to its ink bounding box, centred in a square 1.3× its longer side |
| Ink extent   | 49–50 px of the 64 px frame (5th–95th percentile)                                |
| Stroke width | 3.0 px median (interquartile range 3.0–4.6 px)                                   |
| Output       | 15 probabilities: `0`–`9`, `add`, `div`, `eq`, `mul`, `sub`                      |

Stroke width in these images is not constant: it is the author's fixed pen width divided by how
much each symbol was shrunk to fit. A short minus sign is shrunk less than a tall digit and so
comes out thicker (5 px median against 3 px). Our rasteriser reproduces this by scaling the user's
actual pen width by the same factor it scales the symbol, clamped to the range the model was
trained on.

[`scripts/model/README.md`](../scripts/model/README.md) has the exact commands and commit hashes to
reproduce every number in this section.
