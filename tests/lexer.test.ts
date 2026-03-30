import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';

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

  it('tokenizes when keyword', () => {
    const tokens = tokenize('match x: n when n > 5 -> 1');
    const values = tokens.map(t => t.value);
    expect(values).toContain('when');
  });

  it('tokenizes string interpolation', () => {
    const tokens = tokenize('"Hello ${name}"');
    expect(tokens[0].value).toBe('Hello ${name}');
  });
});