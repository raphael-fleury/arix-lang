import { describe, expect, it } from 'vitest'
import { tokenize } from '../src/lexer.js'

describe('lexer', () => {
  it('tokenizes the v0 surface syntax', () => {
    const tokens = tokenize('module Demo; let value: Int = 42; let items: Array<Int> = [1, 2, 3];')
    expect(tokens.map(token => token.value)).toContain('module')
    expect(tokens.map(token => token.value)).toContain('Demo')
    expect(tokens.map(token => token.value)).toContain('42')
    expect(tokens.map(token => token.value)).toContain('[')
  })

  it('classifies when as keyword and keeps normal identifiers', () => {
    const tokens = tokenize('match value { Just(x) when True => x; }')
    const whenToken = tokens.find(token => token.value === 'when')
    const valueToken = tokens.find(token => token.value === 'value')

    expect(whenToken?.type).toBe('keyword')
    expect(valueToken?.type).toBe('identifier')
  })

  it('skips line and block comments', () => {
    const tokens = tokenize('let a = 1; // trailing\n/* block */ let b = 2;')
    const values = tokens.filter(token => token.type !== 'eof').map(token => token.value)

    expect(values).toEqual(['let', 'a', '=', '1', ';', 'let', 'b', '=', '2', ';'])
  })

  it('tracks line and column after comments and newlines', () => {
    const tokens = tokenize('let a = 1;\n/* x */\nlet b = 2;')
    const secondLet = tokens.find(token => token.value === 'b')

    expect(secondLet?.line).toBe(3)
    expect(secondLet?.column).toBe(5)
  })

  it('tokenizes decimal numbers as a single number token', () => {
    const tokens = tokenize('let pi = 3.14;')
    const numberToken = tokens.find(token => token.type === 'number')

    expect(numberToken?.value).toBe('3.14')
  })

  it('tokenizes string and char escape sequences', () => {
    const tokens = tokenize('let s = "a\\nb"; let c = \'\\n\';')
    const stringToken = tokens.find(token => token.type === 'string')
    const charToken = tokens.find(token => token.type === 'char')

    expect(stringToken?.value).toBe('a\nb')
    expect(charToken?.value).toBe('\n')
  })

  it('tokenizes => as operator', () => {
    const tokens = tokenize('let id = (x) => x;')
    const arrow = tokens.find(token => token.value === '=>')

    expect(arrow?.type).toBe('operator')
  })

  it('always appends eof token with current cursor position', () => {
    const tokens = tokenize('let a = 1;')
    const eof = tokens[tokens.length - 1]

    expect(eof.type).toBe('eof')
    expect(eof.line).toBe(1)
    expect(eof.column).toBe(11)
  })

  it('recovers from unterminated string by consuming until eof', () => {
    const tokens = tokenize('let s = "hello')
    const stringToken = tokens.find(token => token.type === 'string')
    const eof = tokens[tokens.length - 1]

    expect(stringToken?.value).toBe('hello')
    expect(eof.type).toBe('eof')
  })

  it('recovers from unterminated char literal with best-effort tokenization', () => {
    const tokens = tokenize("let c = 'x")
    const charToken = tokens.find(token => token.type === 'char')
    const eof = tokens[tokens.length - 1]

    expect(charToken?.value).toBe('x')
    expect(eof.type).toBe('eof')
  })

  it('ignores unterminated block comment remainder and still emits eof', () => {
    const tokens = tokenize('let a = 1; /* never closes')
    const values = tokens.filter(token => token.type !== 'eof').map(token => token.value)
    const eof = tokens[tokens.length - 1]

    expect(values).toEqual(['let', 'a', '=', '1', ';'])
    expect(eof.type).toBe('eof')
  })
})