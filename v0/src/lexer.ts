export type TokenType = 'identifier' | 'keyword' | 'number' | 'string' | 'char' | 'operator' | 'punctuation' | 'eof'

export interface Token {
  type: TokenType
  value: string
  line: number
  column: number
}

export class LexerError extends Error {
  readonly code = 'ARX1001'
  readonly line: number
  readonly column: number

  constructor(message: string, line: number, column: number) {
    super(message)
    this.name = 'LexerError'
    this.line = line
    this.column = column
  }
}

const keywords = new Set([
  'module',
  'import',
  'enum',
  'let',
  'match',
  'when',
  'typeclass',
  'implementation',
  'where',
  'True',
  'False',
  '_',
])

function isAlpha(char: string): boolean {
  return /[A-Za-z_]/.test(char)
}

function isAlphaNumeric(char: string): boolean {
  return /\w/.test(char)
}

function isDigit(char: string): boolean {
  return /\d/.test(char)
}

function escapeStringFragment(fragment: string): string {
  if (fragment === 'n') return '\n'
  if (fragment === 't') return '\t'
  return fragment
}

function readIdentifier(source: string, index: number): [string, number] {
  let value = ''
  let cursor = index
  while (cursor < source.length && isAlphaNumeric(source[cursor] ?? '')) {
    value += source[cursor]
    cursor += 1
  }
  return [value, cursor]
}

function readNumber(source: string, index: number): [string, number] {
  let value = ''
  let cursor = index
  let sawDot = false
  while (cursor < source.length) {
    const current = source[cursor] ?? ''
    if (isDigit(current)) {
      value += current
      cursor += 1
      continue
    }
    if (current === '.' && !sawDot && isDigit(source[cursor + 1] ?? '')) {
      sawDot = true
      value += current
      cursor += 1
      continue
    }
    break
  }
  return [value, cursor]
}

function readString(source: string, index: number): [string, number, boolean] {
  let value = ''
  let cursor = index + 1
  while (cursor < source.length && source[cursor] !== '"') {
    const current = source[cursor] ?? ''
    if (current === '\\') {
      value += escapeStringFragment(source[cursor + 1] ?? '')
      cursor += 2
      continue
    }
    value += current
    cursor += 1
  }
  const terminated = cursor < source.length && source[cursor] === '"'
  return [value, Math.min(cursor + 1, source.length), terminated]
}

function readChar(source: string, index: number): [string, number, boolean] {
  let cursor = index + 1
  let value = source[cursor] ?? ''
  if (value === '\\') {
    value = escapeStringFragment(source[cursor + 1] ?? '')
    cursor += 2
  } else {
    cursor += 1
  }

  let terminated = false
  if (source[cursor] === "'") {
    terminated = true
    cursor += 1
  }

  return [value, Math.min(cursor, source.length), terminated]
}

interface CursorState {
  index: number
  line: number
  column: number
}

function skipWhitespace(source: string, state: CursorState): boolean {
  const char = source[state.index] ?? ''
  if (char === ' ' || char === '\t' || char === '\r') {
    state.index += 1
    state.column += 1
    return true
  }
  if (char === '\n') {
    state.index += 1
    state.line += 1
    state.column = 1
    return true
  }
  return false
}

function skipLineComment(source: string, state: CursorState): boolean {
  if (source[state.index] !== '/' || source[state.index + 1] !== '/') {
    return false
  }
  state.index += 2
  state.column += 2
  while (state.index < source.length && source[state.index] !== '\n') {
    state.index += 1
    state.column += 1
  }
  return true
}

function skipBlockComment(source: string, state: CursorState): boolean {
  if (source[state.index] !== '/' || source[state.index + 1] !== '*') {
    return false
  }
  state.index += 2
  state.column += 2
  while (state.index < source.length && !(source[state.index] === '*' && source[state.index + 1] === '/')) {
    if (source[state.index] === '\n') {
      state.index += 1
      state.line += 1
      state.column = 1
      continue
    }
    state.index += 1
    state.column += 1
  }
  if (source[state.index] === '*' && source[state.index + 1] === '/') {
    state.index += 2
    state.column += 2
    return true
  }
  throw new LexerError('Unterminated block comment.', state.line, state.column)
}

function skipTrivia(source: string, state: CursorState): void {
  while (state.index < source.length) {
    if (skipWhitespace(source, state)) continue
    if (skipLineComment(source, state)) continue
    if (skipBlockComment(source, state)) continue
    break
  }
}

function readIdentifierToken(source: string, state: CursorState): Token {
  const tokenLine = state.line
  const tokenColumn = state.column
  const [value, nextIndex] = readIdentifier(source, state.index)
  state.column += nextIndex - state.index
  state.index = nextIndex
  return { type: keywords.has(value) ? 'keyword' : 'identifier', value, line: tokenLine, column: tokenColumn }
}

function readNumberToken(source: string, state: CursorState): Token {
  const tokenLine = state.line
  const tokenColumn = state.column
  const [value, nextIndex] = readNumber(source, state.index)
  state.column += nextIndex - state.index
  state.index = nextIndex
  return { type: 'number', value, line: tokenLine, column: tokenColumn }
}

function readStringToken(source: string, state: CursorState): Token {
  const tokenLine = state.line
  const tokenColumn = state.column
  const [value, nextIndex, terminated] = readString(source, state.index)
  for (let cursor = state.index; cursor < nextIndex; cursor += 1) {
    if (source[cursor] === '\n') {
      state.line += 1
      state.column = 1
    } else {
      state.column += 1
    }
  }
  state.index = nextIndex
  if (!terminated) {
    throw new LexerError('Unterminated string literal.', tokenLine, tokenColumn)
  }
  return { type: 'string', value, line: tokenLine, column: tokenColumn }
}

function readCharToken(source: string, state: CursorState): Token {
  const tokenLine = state.line
  const tokenColumn = state.column
  const [value, nextIndex, terminated] = readChar(source, state.index)
  state.column += nextIndex - state.index
  state.index = nextIndex
  if (!terminated) {
    throw new LexerError('Unterminated char literal.', tokenLine, tokenColumn)
  }
  return { type: 'char', value, line: tokenLine, column: tokenColumn }
}

function readSymbolToken(source: string, state: CursorState): Token {
  const char = source[state.index] ?? ''
  const tokenLine = state.line
  const tokenColumn = state.column

  if (char === '=' && source[state.index + 1] === '>') {
    state.index += 2
    state.column += 2
    return { type: 'operator', value: '=>', line: tokenLine, column: tokenColumn }
  }

  if ('{}()[];,.:<>='.includes(char)) {
    state.index += 1
    state.column += 1
    return { type: 'punctuation', value: char, line: tokenLine, column: tokenColumn }
  }

  if (char === '|') {
    state.index += 1
    state.column += 1
    return { type: 'operator', value: char, line: tokenLine, column: tokenColumn }
  }

  state.index += 1
  state.column += 1
  return { type: 'punctuation', value: char, line: tokenLine, column: tokenColumn }
}

function readToken(source: string, state: CursorState): Token {
  const char = source[state.index] ?? ''

  if (char === '"') {
    return readStringToken(source, state)
  }

  if (char === "'") {
    return readCharToken(source, state)
  }

  if (isAlphaNumeric(char) && /[A-Za-z_]/.test(char)) {
    return readIdentifierToken(source, state)
  }

  if (isDigit(char)) {
    return readNumberToken(source, state)
  }

  return readSymbolToken(source, state)
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = []

  const state: CursorState = { index: 0, line: 1, column: 1 }

  while (state.index < source.length) {
    skipTrivia(source, state)
    if (state.index >= source.length) {
      break
    }
    tokens.push(readToken(source, state))
  }

  tokens.push({ type: 'eof', value: '', line: state.line, column: state.column })
  return tokens
}