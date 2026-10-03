# Evaluation on real handwriting

`npm test` uses synthetic handwriting, which is exact and repeatable but written by nobody. The
scripts here measure recognition on handwriting from real people. They are not part of `npm test`
because the data is not in this repository.

## Pen-written digits

**Data:** [Pen-Based Recognition of Handwritten Digits](https://archive.ics.uci.edu/dataset/81/pen+based+recognition+of+handwritten+digits),
E. Alpaydin and F. Alimoglu, UCI Machine Learning Repository, 1998. Licence: CC BY 4.0.
10,992 digits written with a stylus on a tablet by 44 people. The original files hold the pen
trajectories, so the digits arrive as strokes, exactly as the app captures ink.

**Get it:**

```
mkdir -p data/pendigits && cd data/pendigits
curl -L -o pendigits.zip "https://archive.ics.uci.edu/static/public/81/pen+based+recognition+of+handwritten+digits.zip"
unzip pendigits.zip
gzip -dk pendigits-orig.tes.Z pendigits-orig.tra.Z
```

**Run it:**

```
npm run eval:digits
```

Each digit is scaled to the height it would have on the page and recognised by the same function
the app's worker calls, then also taken through layout and the geometric prior. The report gives
accuracy for the main model alone, for recognition as the app does it with the digit helpers
voting, and for the whole path; a per-digit table; the most common confusions; and how often the
confidence indicator flags a misread.

Expected on the test set: 93.48% for the main model alone, 97.80% with the helpers, 96.86% for the
whole path.

| Variable          | Default          | Meaning                                                  |
| ----------------- | ---------------- | -------------------------------------------------------- |
| `PENDIGITS_DIR`   | `data/pendigits` | Folder holding the unpacked files                        |
| `PENDIGITS_SPLIT` | `test`           | `test` (14 writers, 3,498 digits) or `train` (30, 7,494) |
| `EVAL_SIZE`       | `80`             | Height the digits are written at, in pixels              |
| `EVAL_PEN`        | `4`              | Pen width, in pixels                                     |
| `EVAL_SHOW`       |                  | A confusion such as `4→9`: prints six examples as text   |

The data set has digits only. Operators are not covered by it.
