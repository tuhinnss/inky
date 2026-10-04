import type { Node } from './parser';

export type EvaluationResult =
  | { kind: 'value'; value: number }
  /** Division by zero. `position` is the index of the "÷" that caused it. */
  | { kind: 'undefined'; position: number }
  /** The true result does not fit in a double. */
  | { kind: 'overflow' }
  /** A variable with no value. `position` is the index of the variable. */
  | { kind: 'unknown-variable'; name: string; position: number };

interface Frame {
  node: Node;
  /** False on the way down, true once the node's operands have been evaluated. */
  operandsReady: boolean;
}

/**
 * Evaluates the tree bottom-up, operands before operators, left before right.
 *
 * The obvious way to write this is a function that calls itself on `left` and `right`.
 * That breaks on long input: `1+1+1+...` parses into a tree that leans left, one level
 * per term, and a few thousand levels of recursion overflow the call stack. That would
 * be an exception on malformed-but-harmless input, which this engine must never throw.
 * So the traversal keeps its own stack on the heap instead: `pending` holds the nodes
 * still to visit and `values` holds the results waiting for their operator.
 *
 * Division by zero is reported the moment it is seen rather than letting Infinity or
 * NaN flow upwards. Otherwise `1 ÷ 0 × 0` would surface as a bare NaN with nothing left
 * to say why.
 */
export function evaluateNode(
  root: Node,
  variables: ReadonlyMap<string, number> = new Map(),
): EvaluationResult {
  const pending: Frame[] = [{ node: root, operandsReady: false }];
  const values: number[] = [];

  while (pending.length > 0) {
    const { node, operandsReady } = pending.pop()!;
    let value: number;

    if (node.type === 'number') {
      value = node.value;
    } else if (node.type === 'variable') {
      const known = variables.get(node.name);
      if (known === undefined) {
        return { kind: 'unknown-variable', name: node.name, position: node.position };
      }
      value = known;
    } else if (!operandsReady) {
      pending.push({ node, operandsReady: true });
      if (node.type === 'negate') {
        pending.push({ node: node.operand, operandsReady: false });
      } else {
        // Pushed right then left, so that left is popped, and therefore evaluated, first.
        pending.push({ node: node.right, operandsReady: false });
        pending.push({ node: node.left, operandsReady: false });
      }
      continue;
    } else if (node.type === 'negate') {
      value = -values.pop()!;
    } else {
      const right = values.pop()!;
      const left = values.pop()!;
      if (node.operator === '÷' && right === 0) {
        return { kind: 'undefined', position: node.position };
      }
      value = apply(node.operator, left, right);
    }

    if (!Number.isFinite(value)) return { kind: 'overflow' };
    values.push(value);
  }

  return { kind: 'value', value: values[0] };
}

function apply(operator: '+' | '-' | '×' | '÷', left: number, right: number): number {
  switch (operator) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '×':
      return left * right;
    case '÷':
      return left / right;
  }
}
