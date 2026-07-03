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
})