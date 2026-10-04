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

Expected on the test set: 93.48% for the main model alone, 97.80% with the helpers, 97.00% for the
whole path.

| Variable          | Default          | Meaning                                                  |
| ----------------- | ---------------- | -------------------------------------------------------- |
| `PENDIGITS_DIR`   | `data/pendigits` | Folder holding the unpacked files                        |
| `PENDIGITS_SPLIT` | `test`           | `test` (14 writers, 3,498 digits) or `train` (30, 7,494) |
| `EVAL_SIZE`       | `80`             | Height the digits are written at, in pixels              |
| `EVAL_PEN`        | `4`              | Pen width, in pixels                                     |
| `EVAL_SHOW`       |                  | A confusion such as `4→9`: prints six examples as text   |

The data set has digits only. Operators are measured on the next data set.

## Handwritten operators and whole expressions

**Data:** [MathWriting](https://github.com/google-research/google-research/tree/master/mathwriting),
P. Gervais, A. Fadeeva, A. Maksai, Google Research, 2024. Licence: CC BY-NC-SA 4.0, which allows
this non-commercial measurement; none of the data is copied into this repository. 230,000
expressions written by people on touchscreens and with digital pens, stored as strokes. None of
the models CalcInk bundles was trained on it, so every ink in it is new to them.

Nearly all of it is algebra and calculus. `prepare_mathwriting.py` reads the archive once and
keeps the inks whose label uses only CalcInk's vocabulary (digits, `+ − × ÷ =` and the decimal
point): whole expressions such as `12+7=19`, and single symbols that the data set's authors cut
out of longer inks.

**Get it** (2.9 GB download):

```
mkdir -p data/mathwriting && cd data/mathwriting
curl -L -o mathwriting-2024.tgz https://storage.googleapis.com/mathwriting_data/mathwriting-2024.tgz
python ../../scripts/eval/prepare_mathwriting.py mathwriting-2024.tgz arithmetic.jsonl
```

**Run it:**

```
npm run eval:operators
```

Each ink is scaled to the size of handwriting on the page. A single symbol is read on its own, as
a lone sign on the page. A whole expression goes through the same path as ink on the page:
grouping into lines and symbols, recognition, and reading. The report gives, for each symbol,
how often it is read right on its own and inside expressions; how many expressions are read
exactly right; why the others are not; and the most common confusions.

| Variable           | Default                             | Meaning                                 |
| ------------------ | ----------------------------------- | --------------------------------------- |
| `MATHWRITING_FILE` | `data/mathwriting/arithmetic.jsonl` | The file `prepare_mathwriting.py` wrote |
| `EVAL_SIZE`        | `80`                                | Height the writing is brought to, in px |
| `EVAL_PEN`         | `4`                                 | Pen width, in pixels                    |
| `EVAL_REPORT`      |                                     | Also write the report to this file      |

Expected: 86.6% of expressions read exactly right, 91.8% grouped into the right symbols, and 98.1%
of symbols read right within those.
