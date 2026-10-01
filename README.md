# CalcInk

A web notebook that does your arithmetic. Write an expression by hand, end it with `=`, and the
answer appears on the page next to it. Change the expression and the answer follows.

Everything runs in the browser: stroke capture, handwriting recognition and evaluation. There is
no server and nothing is sent anywhere.

Built for the Inter IIT Tech Meet 15.0 Bootcamp, Phase 1 Software problem statement
([docs/problem-statement.pdf](docs/problem-statement.pdf)).

## Quick start

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

## Scripts

| Command           | What it does                       |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Start the dev server               |
| `npm run build`   | Type-check, then build to `dist/`  |
| `npm run preview` | Serve the production build locally |
| `npm test`        | Run the unit tests once            |
| `npm run lint`    | Lint the source                    |
| `npm run format`  | Format the source with Prettier    |

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
| Bundled file | [public/models/symbol-classifier.onnx](public/models/symbol-classifier.onnx), 1.54 MB: the upstream weights converted from Keras to ONNX, unchanged             |
| Accuracy     | 99.44% on the upstream held-out test set (1,599 of 1,608), reproduced by us after conversion                                                                    |

Why this model, what else we evaluated, and a note on the provenance of its training data are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#1-model-selection). The conversion and benchmark
scripts are in [scripts/model](scripts/model).
