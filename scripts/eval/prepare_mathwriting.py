"""Picks the arithmetic out of the MathWriting data set, for `npm run eval:operators`.

MathWriting is 230,000 handwritten expressions, nearly all of them algebra and calculus that
CalcInk does not set out to read. This reads the archive once, straight from the .tgz without
unpacking it, and keeps only the inks written by people whose label uses nothing but CalcInk's
vocabulary: digits, + − × ÷ =, the decimal point and the variable x. Each is written to one
line of a JSON Lines file, with its strokes.

    python scripts/eval/prepare_mathwriting.py mathwriting-2024.tgz data/mathwriting/arithmetic.jsonl

Two kinds of ink come out:
  expression  a whole expression from train/, valid/ or test/, such as 12+7=19
  symbol      a single symbol from symbols/, cut out of a training ink by the data set's authors
"""

import json
import re
import sys
import tarfile
import xml.etree.ElementTree as ElementTree

NS = '{http://www.w3.org/2003/InkML}'
TOKEN = re.compile(r'\\times|\\div|\\cdot|\\[a-zA-Z]+|.')
# LaTeX tokens CalcInk reads, and the character each one is in an expression the app writes.
VOCABULARY = {**{d: d for d in '0123456789'}, '+': '+', '-': '-', '=': '=', '.': '.',
              '\\times': '×', '\\div': '÷', 'x': 'x'}


def expression_of(latex: str):
    """The expression as CalcInk would write it, or None if any of it is outside its reach."""
    tokens = TOKEN.findall(latex.replace(' ', ''))
    if not tokens or any(token not in VOCABULARY for token in tokens):
        return None
    return ''.join(VOCABULARY[token] for token in tokens)


def read_ink(data: bytes):
    root = ElementTree.fromstring(data)
    notes = {a.get('type'): (a.text or '') for a in root.iter(NS + 'annotation')}
    strokes = []
    for trace in root.iter(NS + 'trace'):
        points = []
        for point in (trace.text or '').split(','):
            values = point.split()
            if len(values) >= 2:
                points += [round(float(values[0]), 1), round(float(values[1]), 1)]
        if points:
            strokes.append(points)
    return notes, strokes


def main(archive: str, out: str) -> None:
    kept = {'expression': 0, 'symbol': 0}
    seen = 0
    with tarfile.open(archive, 'r:gz') as tar, open(out, 'w', encoding='utf-8') as sink:
        for member in tar:
            if not member.isfile() or not member.name.endswith('.inkml'):
                continue
            split = member.name.split('/')[-2]
            if split not in ('train', 'valid', 'test', 'symbols'):
                continue  # synthetic/ is glyphs stitched together, not people writing
            seen += 1
            notes, strokes = read_ink(tar.extractfile(member).read())
            if notes.get('inkCreationMethod') != 'human':
                continue
            kind = 'symbol' if split == 'symbols' else 'expression'
            label = notes.get('label' if kind == 'symbol' else 'normalizedLabel', '')
            expression = expression_of(label)
            if expression is None or (kind == 'symbol' and len(expression) != 1):
                continue
            kept[kind] += 1
            record = {'id': notes.get('sampleId'), 'split': split, 'kind': kind,
                      'label': expression, 'strokes': strokes}
            sink.write(json.dumps(record, ensure_ascii=False) + '\n')
            if seen % 20000 == 0:
                print(f'{seen} inks read, kept {kept}', flush=True)
    print(f'{seen} inks read, kept {kept}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
