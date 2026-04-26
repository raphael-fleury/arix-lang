import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';

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

  it('does not tokenize .. or ... as operators', () => {
    const tokens = tokenize('a . b');
    const nonPunct = tokens.filter(t => t.type !== 'NEWLINE' && t.type !== 'EOF' && t.value !== '');
    // Should tokenize as: identifier, punctuation(.), identifier
    expect(nonPunct.map(t => [t.type, t.value])).toEqual([
      ['IDENTIFIER', 'a'],
      ['PUNCTUATION', '.'],
      ['IDENTIFIER', 'b'],
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
});