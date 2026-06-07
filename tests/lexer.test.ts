import { describe, it, expect } from 'vitest';
import { tokenize, OPERATORS, ESCAPE_SEQUENCES } from '../src/lexer.js';

function nonEmpty(tokens: ReturnType<typeof tokenize>) {
  return tokens.filter(t => !(t.type === 'EOF' && t.value === ''));
}

describe('Lexer', () => {
  it('tokenizes simple arithmetic', () => {
    const tokens = tokenize('1 + 2');
    const values = tokens.map(t => t.value).filter(v => v !== '');
    expect(values).toEqual(['1', '+', '2']);
  });

  it('tokenizes keywords', () => {
    const tokens = tokenize('fn main() = 1');
    const values = tokens.map(t => t.value).filter(v => v !== '');
    expect(values).toEqual(['fn', 'main', '(', ')', '=', '1']);
  });

  it('tokenizes string interpolation', () => {
    const tokens = tokenize('"Hello ${name}"');
    expect(tokens[0].value).toBe('Hello ${name}');
  });

  it('tokenizes integers and floats', () => {
    const testCases = [
      { input: '42', expected: ['42'] },
      { input: '3.14', expected: ['3.14'] },
      { input: '0.5', expected: ['0.5'] },
      { input: '1.0', expected: ['1.0'] },
    ];

    for (const { input, expected } of testCases) {
      const tokens = tokenize(input).filter(t => t.type === 'NUMBER');
      const values = tokens.map(t => t.value);
      expect(values).toEqual(expected);
    }
  });

  it('rejects multiple dots in numbers', () => {
    const tokens = tokenize('1.2.3');
    const numbers = tokens.filter(t => t.type === 'NUMBER').map(t => t.value);
    const operators = tokens.filter(t => t.type === 'OPERATOR').map(t => t.value);
    
    // Should tokenize as: NUMBER(1.2) + OPERATOR(.) + NUMBER(3)
    expect(numbers).toEqual(['1.2', '3']);
    expect(operators).toContain('.');
  });

  it('handles trailing dot as operator', () => {
    const tokens = tokenize('1.');
    const numbers = tokens.filter(t => t.type === 'NUMBER').map(t => t.value);
    const operators = tokens.filter(t => t.type === 'OPERATOR').map(t => t.value);
    
    expect(numbers).toEqual(['1']);
    expect(operators).toEqual(['.']);
  });

  it('processes escape sequences in strings', () => {
    for (const [escaped, actual] of Object.entries(ESCAPE_SEQUENCES)) {
      const code = `"hello${escaped}world"`;
      const tokens = tokenize(code);
      expect(tokens[0].type).toBe('STRING');
      expect(tokens[0].value).toBe(`hello${actual}world`);
    }
  });

  it('handles unicode escape sequences \\uXXXX', () => {
    const tokens = tokenize('"\\u0041"'); // \u0041 = 'A'
    expect(tokens[0].value).toBe('A');
  });

  it('skips # comments (does not emit tokens for them)', () => {
    const tokens = tokenize('1 # comment here\n2');
    const t = nonEmpty(tokens);
    expect(t.map(x => x.value)).toEqual(['1', '\n', '2']);
    expect(t.map(x => x.type)).toEqual(['NUMBER', 'NEWLINE', 'NUMBER']);
  });

  it('tokenizes multi-character operators', () => {
    const tokens = tokenize('a == b != c <= d >= e -> f |> g');
    const values = nonEmpty(tokens).map(t => t.value);
    expect(values).toContain('==');
    expect(values).toContain('!=');
    expect(values).toContain('<=');
    expect(values).toContain('>=');
    expect(values).toContain('->');
    expect(values).toContain('|>');
  });

  it('tokenizes relative imports (./ and ../) as RELATIVE', () => {
    const tokens = tokenize('import ./foo\nimport ../bar');
    const rels = tokens.filter(t => t.type === 'RELATIVE').map(t => t.value);
    expect(rels).toEqual(['./', '../']);
  });

  it('tokenizes identifiers with hyphens', () => {
    const tokens = tokenize('import my-lib as my-lib');
    const ids = tokens.filter(t => t.type === 'IDENTIFIER').map(t => t.value);
    expect(ids).toEqual(['my-lib', 'my-lib']);
  });

  it('tokenizes triple-quoted strings', () => {
    const tokens = tokenize('"""hello\nworld"""');
    expect(tokens[0].type).toBe('STRING');
    expect(tokens[0].value).toBe('hello\nworld');
  });

  it('emits NEWLINE tokens and advances line numbers', () => {
    const tokens = tokenize('a\nb\nc');
    const newlines = tokens.filter(t => t.type === 'NEWLINE');
    expect(newlines).toHaveLength(2);

    const ids = tokens.filter(t => t.type === 'IDENTIFIER');
    expect(ids.map(t => [t.value, t.line])).toEqual([['a', 1], ['b', 2], ['c', 3]]);
  });

  it('always ends with EOF', () => {
    const tokens = tokenize('');
    expect(tokens[tokens.length - 1].type).toBe('EOF');
  });

  it('tokenizes Ok/Err/Some/None as IDENTIFIER (type constructors)', () => {
    const tokens = tokenize('Ok(value) Err(e) Some(x) None');
    const ids = tokens.filter(t => t.type === 'IDENTIFIER').map(t => t.value);
    expect(ids).toEqual(['Ok', 'value', 'Err', 'e', 'Some', 'x', 'None']);
  });

  it('tokenizes boolean values as KEYWORD', () => {
    const tokens = tokenize('true false');
    const keywords = tokens.filter(t => t.type === 'KEYWORD').map(t => t.value);
    expect(keywords).toEqual(['true', 'false']);
  });

  it('treats unsupported control-flow words as identifiers', () => {
    const tokens = tokenize('loop try catch throw yield');
    const identifiers = tokens.filter(t => t.type === 'IDENTIFIER').map(t => t.value);
    const keywords = tokens.filter(t => t.type === 'KEYWORD').map(t => t.value);

    expect(identifiers).toEqual(['loop', 'try', 'catch', 'throw', 'yield']);
    expect(keywords).toEqual([]);
  });

  it('tokenizes dot as an operator', () => {
    const tokens = tokenize('a . b');
    const nonPunct = tokens.filter(t => t.type !== 'NEWLINE' && t.type !== 'EOF' && t.value !== '');
    // Should tokenize as: identifier, operator(.), identifier
    expect(nonPunct.map(t => [t.type, t.value])).toEqual([
      ['IDENTIFIER', 'a'],
      ['OPERATOR', '.'],
      ['IDENTIFIER', 'b'],
    ]);
  });

  it('tokenizes tight dot as punctuation for member access', () => {
    const tokens = tokenize('obj.field');
    const nonEmptyTokens = nonEmpty(tokens).filter(t => t.value !== '');
    expect(nonEmptyTokens.map(t => [t.type, t.value])).toEqual([
      ['IDENTIFIER', 'obj'],
      ['PUNCTUATION', '.'],
      ['IDENTIFIER', 'field'],
    ]);
  });

  it('emits INDENT token on indentation increase', () => {
    const tokens = tokenize('fn main()\n  x');
    const types = tokens.map(t => t.type);
    expect(types).toContain('INDENT');
  });

  it('emits DEDENT token on indentation decrease', () => {
    const tokens = tokenize('fn main()\n  x\ny');
    const types = tokens.map(t => t.type);
    expect(types).toContain('DEDENT');
  });

  it('emits multiple DEDENTs on multiple indentation decreases', () => {
    const tokens = tokenize('a\n  b\n    c\nd');
    const dedents = tokens.filter(t => t.type === 'DEDENT');
    expect(dedents).toHaveLength(2);
  });

  it('ignores empty lines in indentation tracking', () => {
    const tokens = tokenize('a\n  b\n\n  c\nd');
    const indents = tokens.filter(t => t.type === 'INDENT');
    const dedents = tokens.filter(t => t.type === 'DEDENT');
    expect(indents).toHaveLength(1);
    expect(dedents).toHaveLength(1);
  });

  it('ignores comment-only lines in indentation tracking', () => {
    const tokens = tokenize('a\n  b\n  # comment\n  c\nd');
    const indents = tokens.filter(t => t.type === 'INDENT');
    const dedents = tokens.filter(t => t.type === 'DEDENT');
    expect(indents).toHaveLength(1);
    expect(dedents).toHaveLength(1);
  });

  it('maintains indentation stack correctly', () => {
    const src = `fn add(x, y)
  result = x + y
  result`;
    const tokens = tokenize(src);
    const types = tokens.map(t => t.type);
    // Should have: NEWLINE, INDENT (before result), ..., no DEDENT before EOF
    expect(types.filter(t => t === 'INDENT')).toHaveLength(1);
    expect(types.filter(t => t === 'DEDENT')).toHaveLength(1); // One at EOF
  });

  it('tokenizes 3-character operator ??= correctly (greedy match)', () => {
    const tokens = tokenize('x ??= 5');
    const ops = tokens.filter(t => t.type === 'OPERATOR').map(t => t.value);
    expect(ops).toEqual(['??=']);
  });

  it('tokenizes all operators as single tokens with greedy matching', () => {
    for (const op of OPERATORS) {
      // Wrap operator with spaces and identifier to ensure isolation
      const code = `a ${op} b`;
      const tokens = tokenize(code);
      const operators = tokens.filter(t => t.type === 'OPERATOR');
      
      expect(operators).toHaveLength(1);
      expect(operators[0].value).toBe(op);
    }
  });

  it('detects unterminated strings', () => {
    const tokens = tokenize('"hello world');
    const errors = tokens.filter(t => t.type === 'ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Unterminated string');
  });

  it('detects unterminated triple-quoted strings', () => {
    const tokens = tokenize('"""hello world');
    const errors = tokens.filter(t => t.type === 'ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Unterminated triple-quoted string');
  });

  it('reports unexpected characters as ERROR tokens', () => {
    const tokens = tokenize('a @ b');
    const errors = tokens.filter(t => t.type === 'ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0].value).toBe('@');
    expect(errors[0].message).toContain('Unexpected character');
  });

  it('includes line and column info in ERROR tokens', () => {
    const tokens = tokenize('a\n  @');
    const errors = tokens.filter(t => t.type === 'ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
    expect(errors[0].column).toBe(3);
  });

  it('tokenizes regular strings as STRING type', () => {
    const tokens = tokenize('"hello world"');
    expect(tokens[0].type).toBe('STRING');
    expect(tokens[0].value).toBe('hello world');
  });

  it('tokenizes interpolated strings as INTERPOLATED_STRING type', () => {
    const tokens = tokenize('"Hello ${name}"');
    expect(tokens[0].type).toBe('INTERPOLATED_STRING');
    expect(tokens[0].value).toBe('Hello ${name}');
  });

  it('tokenizes strings with multiple interpolations', () => {
    const tokens = tokenize('"${x} + ${y} = ${result}"');
    expect(tokens[0].type).toBe('INTERPOLATED_STRING');
    expect(tokens[0].value).toBe('${x} + ${y} = ${result}');
  });

  it('preserves raw content of interpolated strings', () => {
    const testCases = [
      '"Start ${a} middle ${b} end"',
      '"${func()}"',
      '"${obj.prop.method()}"',
      '"${a ? b : c}"',
    ];

    for (const code of testCases) {
      const tokens = tokenize(code);
      const strToken = tokens.find(t => t.type === 'INTERPOLATED_STRING' || t.type === 'STRING');
      expect(strToken).toBeDefined();
      // Raw content should match input minus quotes
      expect(strToken!.value).toBe(code.slice(1, -1));
    }
  });

  it('tokenizes interpolated string with escaped dollar sign', () => {
    const tokens = tokenize('"Price: \\$${amount}"');
    // Should have INTERPOLATED_STRING since there's ${...}
    const strToken = tokens.find(t => t.type === 'INTERPOLATED_STRING');
    expect(strToken).toBeDefined();
    expect(strToken!.value).toContain('\\$');
  });

  it('distinguishes between STRING and INTERPOLATED_STRING', () => {
    const regular = tokenize('"just a string"');
    const interpolated = tokenize('"string with ${expr}"');

    expect(regular[0].type).toBe('STRING');
    expect(interpolated[0].type).toBe('INTERPOLATED_STRING');
  });

  it('tokenizes INTERPOLATED_STRING after INDENT', () => {
    const tokens = tokenize('fn main()\n  x = "Hello ${world}"');
    const interpolated = tokens.find(t => t.type === 'INTERPOLATED_STRING');
    expect(interpolated).toBeDefined();
    expect(interpolated!.value).toBe('Hello ${world}');
  });
});