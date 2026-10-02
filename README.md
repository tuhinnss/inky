# Inky

A notebook page that does your arithmetic. Write an expression by hand, end it with `=`, and the
answer is pencilled in beside it. Change the expression and the answer follows.

Everything runs in the browser: stroke capture, handwriting recognition and evaluation. There is
no server, and nothing you write leaves your device. After the first visit it works with no
network connection at all.

![Inky with three handwritten equations and their answers](docs/screenshot.png)

Inky is our entry for the Inter IIT Tech Meet 15.0 Bootcamp, Phase 1 Software problem statement,
"CalcInk: On-Device Handwritten Math Calculator" ([docs/problem-statement.pdf](docs/problem-statement.pdf)).

**Live demo:** _link to be added on deployment_

## Quick start

Requires Node.js 20.19 or later (22.12 or later on the 22 line).

```bash
npm install
npm run dev
```

Then open the address Vite prints, normally <http://localhost:5173>.

To try the production build, including offline support:

```bash
npm run build
npm run preview
```

## Using it

Write with a mouse, a finger or a stylus. Finish an expression with `=` and pause; the answer
appears about a third of a second after you stop writing.

- Digits `0`–`9`, the operators `+` `−` `×` `÷`, and the decimal point are recognised.
- Standard precedence applies: `18 + 4 × 3 =` gives 30.
- Negative numbers work: `3 × −2 =` gives −6.
- Dividing by zero gives `Undefined`.
- Write as many equations on the page as you like. Each is worked out separately.
- Erase a number and write another in its place, and the answer updates.

Your writing is ink. Everything the notebook works out is drawn in pencil. When it is unsure of a
symbol it read, the answer is fainter and the doubtful symbol is underlined with a dotted line and
labelled with what it was taken to be. When an expression does not make sense, the symbol at fault
is marked and a note says why.

| Tool, in the margin            | Key      |
| ------------------------------ | -------- |
| Pen                            | `P`      |
| Erase whole strokes            | `E`      |
| Rub out part of a stroke       | `R`      |
| Pen width, four sizes          |          |
| Undo                           | `Ctrl+Z` |
| Redo                           | `Ctrl+Y` |
| Clear the page (can be undone) |          |

The eraser end of a stylus erases without changing tool.

## How it works

Ink is kept as vectors from the first pointer event to the last step of recognition.

1. **Capture.** Pointer events become immutable strokes, drawn on a canvas scaled for the device
   pixel ratio.
2. **Layout.** After 350 ms of quiet, strokes are grouped into lines and then into symbols using
   their bounding boxes.
3. **Recognise.** In a Web Worker, each new symbol is redrawn from its coordinates into a 64×64
   image and classified by a small convolutional network running on WebAssembly.
4. **Interpret.** The model's probabilities are combined with stroke geometry. The decimal point
   is decided by geometry alone.
5. **Evaluate.** A recursive-descent parser turns the symbols into a result. No `eval`.
6. **Draw.** The answer is written on an overlay canvas next to the `=`.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers each step, the reasoning behind it, and the
measured performance and memory figures.

## Model attribution

Symbols are recognised by a pre-trained convolutional network that ships with the app. We did not
train it.

|              |                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model        | `cnn_aug` from [altynbk/handwritten-math-recognition](https://github.com/altynbk/handwritten-math-recognition), commit `3d91c0c`                                |
| Licence      | MIT, copyright Altynbek Kabiyev. Full text in [public/models/LICENSE.txt](public/models/LICENSE.txt)                                                            |
| Architecture | 4 × (3×3 convolution, batch normalisation, 2×2 max-pool) with 32, 64, 128 and 256 filters, then global average pooling and a 15-way softmax. 393,615 parameters |
| Input        | One symbol as a 64×64 greyscale image                                                                                                                           |
| Output       | Probabilities for `0`–`9`, `+`, `−`, `×`, `÷` and `=`. The decimal point is identified from stroke geometry                                                     |
| Bundled file | [public/models/symbol-classifier.onnx](public/models/symbol-classifier.onnx), 1.58 MB: the upstream weights converted from Keras to ONNX, unchanged             |
| Accuracy     | 99.44% on the upstream held-out test set (1,599 of 1,608), reproduced by us after conversion                                                                    |

Why this model, what else we evaluated, and a note on the provenance of its training data are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#2-model-selection). The conversion and benchmark
scripts are in [scripts/model](scripts/model).

## Scripts

| Command             | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | Start the dev server                               |
| `npm run build`     | Type-check, then build to `dist/`                  |
| `npm run preview`   | Serve the production build locally                 |
| `npm test`          | Run the 346 unit and integration tests once        |
| `npm run typecheck` | Type-check without building                        |
| `npm run lint`      | Lint the source. Fails on `eval` or `new Function` |
| `npm run format`    | Format the source with Prettier                    |

## Project layout

```
src/
  ink/           strokes, stroke store, undo/redo, erasers
  canvas/        coordinate conversion, canvas layers, pointer input, rendering
  layout/        grouping strokes into lines and symbols
  recognition/   rasteriser, worker, model adapter, fusing model output with geometry
  math/          tokenizer, parser, evaluator, number formatting
  app/           the pipeline connecting the stages; scheduling; app shell
  ui/            toolbar, answer overlay
  styles/        the notebook page
public/models/   the ONNX model and its licence
scripts/model/   model conversion and benchmark scripts (Python; not needed to run the app)
tests/           mirrors src/, plus synthetic-handwriting fixtures
docs/            architecture document, problem statement
```

## Deploying

`npm run build` produces a static site in `dist/` that can be served from any static host. The
build uses relative paths, so it works at a domain root and under a sub-path without changes.

The host must serve over HTTPS, which service workers require. No special response headers are
needed.

## Third-party software

| Component                                                                                       | Licence | Used for                    |
| ----------------------------------------------------------------------------------------------- | ------- | --------------------------- |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime)                                     | MIT     | Running the model on WASM   |
| [perfect-freehand](https://github.com/steveruizok/perfect-freehand)                             | MIT     | Smoothing strokes           |
| Kalam by Indian Type Foundry, via `@fontsource/kalam`                                           | OFL-1.1 | The pencil handwriting face |
| [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) and Workbox                      | MIT     | The service worker          |
| [altynbk/handwritten-math-recognition](https://github.com/altynbk/handwritten-math-recognition) | MIT     | The recognition model       |

The font's licence is distributed with the app at
[public/licenses/Kalam-OFL.txt](public/licenses/Kalam-OFL.txt).
