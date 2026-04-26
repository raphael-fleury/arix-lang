export type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'IDENTIFIER'
  | 'KEYWORD'
  | 'OPERATOR'
  | 'PUNCTUATION'
  | 'RELATIVE'
  | 'NEWLINE'
  | 'INDENT'
  | 'DEDENT'
  | 'ERROR'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  message?: string; // Error message for ERROR tokens
}

export const KEYWORDS = [
  'fn', 'let', 'mut', 'public', 'internal', 'match', 'when',
  'import', 'type', 'if', 'then', 'else', 'try', 'catch', 'async', 'await',
  'true', 'false', 'as', 'in', 'for',
  'where', 'return', 'yield', 'throw', 'break', 'continue', 'loop',
] as const;

export const OPERATORS = [
  '+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=',
  '&&', '||', '!', '=', '+=', '-=', '*=', '/=', '|>', '++',
  '::', '??', '??=', '->', '=>',
] as const;

// Operators sorted by length (descending) for greedy matching
const OPERATORS_BY_LENGTH = [...OPERATORS].sort((a, b) => b.length - a.length);

export const PUNCTUATION = [
  '(', ')', '[', ']', '{', '}', ',', ':', ';', '.', '|',
] as const;

// Map of escape sequences to their actual characters
export const ESCAPE_SEQUENCES: Record<string, string> = {
  '\\n': '\n',
  '\\t': '\t',
  '\\r': '\r',
  '\\b': '\b',
  '\\f': '\f',
  '\\v': '\v',
  '\\\\': '\\',
  '\\"': '"',
};

function processEscapeSequences(str: string): string {
  let result = '';
  let i = 0;
  while (i < str.length) {
    if (str[i] === '\\' && i + 1 < str.length) {
      const twoChar = str.slice(i, i + 2);
      if (twoChar in ESCAPE_SEQUENCES) {
        result += ESCAPE_SEQUENCES[twoChar];
        i += 2;
        continue;
      }
      // Unicode escape: \uXXXX
      if (str[i + 1] === 'u' && i + 5 < str.length) {
        const hexCode = str.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hexCode)) {
          result += String.fromCharCode(parseInt(hexCode, 16));
          i += 6;
          continue;
        }
      }
    }
    result += str[i];
    i++;
  }
  return result;
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  const keywords = new Set(KEYWORDS);
  const operators = new Set<string>(OPERATORS);
  const punctuation = new Set<string>(PUNCTUATION);
  
  // Indentation tracking
  const indentStack: number[] = [0];
  let atLineStart = true;
  let currentLineIndent = 0;

  const emitIndentTokens = (newIndent: number) => {
    const currentIndent = indentStack[indentStack.length - 1];
    
    if (newIndent > currentIndent) {
      indentStack.push(newIndent);
      tokens.push({ type: 'INDENT', value: '', line, column: 1 });
    } else if (newIndent < currentIndent) {
      while (indentStack.length > 1 && indentStack[indentStack.length - 1] > newIndent) {
        indentStack.pop();
        tokens.push({ type: 'DEDENT', value: '', line, column: 1 });
      }
    }
  };

  while (pos < source.length) {
    const char = source[pos];

    // Handle newlines
    if (char === '\n') {
      tokens.push({ type: 'NEWLINE', value: '\n', line, column });
      line++;
      column = 1;
      pos++;
      atLineStart = true;
      currentLineIndent = 0;
      continue;
    }

    // Process indentation at line start
    if (atLineStart && char === ' ') {
      currentLineIndent++;
      column++;
      pos++;
      continue;
    }

    // At first non-space character on a line
    if (atLineStart && char !== '\n') {
      // Skip comment-only lines and empty lines
      if (char !== '#') {
        emitIndentTokens(currentLineIndent);
      }
      atLineStart = false;
    }

    // Skip comments
    if (char === '#') {
      while (pos < source.length && source[pos] !== '\n') {
        pos++;
      }
      atLineStart = true;
      currentLineIndent = 0;
      continue;
    }

    // Skip other whitespace
    if (/\s/.test(char)) {
      column++;
      pos++;
      continue;
    }

    // String literals
    if (char === '"') {
      const stringStartCol = column;
      const stringStartLine = line;
      
      if (source.slice(pos, pos + 3) === '"""') {
        const end = source.indexOf('"""', pos + 3);
        if (end === -1) {
          // Unterminated triple-quoted string
          tokens.push({
            type: 'ERROR',
            value: source.slice(pos),
            line,
            column: stringStartCol,
            message: `Unterminated triple-quoted string starting at line ${stringStartLine}:${stringStartCol}`,
          });
          break;
        }
        const value = processEscapeSequences(source.slice(pos + 3, end));
        tokens.push({ type: 'STRING', value, line, column });
        pos = end + 3;
        column += end - pos;
      } else {
        pos++;
        let value = '';
        while (pos < source.length && source[pos] !== '"') {
          value += source[pos];
          pos++;
          column++;
        }
        
        if (pos >= source.length) {
          // Unterminated string
          tokens.push({
            type: 'ERROR',
            value: value,
            line: stringStartLine,
            column: stringStartCol,
            message: `Unterminated string starting at line ${stringStartLine}:${stringStartCol}`,
          });
          break;
        }
        
        tokens.push({ type: 'STRING', value: processEscapeSequences(value), line, column });
        pos++;
      }
      continue;
    }

    // Numbers
    if (/\d/.test(char)) {
      let value = '';
      let hasDot = false;
      while (pos < source.length && /[\d.]/.test(source[pos])) {
        if (source[pos] === '.') {
          // Only allow one decimal point
          if (hasDot) break;
          // Don't allow dot at the start
          if (value.length === 0) break;
          hasDot = true;
        }
        value += source[pos];
        pos++;
        column++;
      }
      // Remove trailing dot if present (e.g., "1." -> "1")
      if (value.endsWith('.')) {
        value = value.slice(0, -1);
        pos--;
        column--;
      }
      tokens.push({ type: 'NUMBER', value, line, column });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(char)) {
      let value = '';
      while (pos < source.length && /[a-zA-Z0-9_\-]/.test(source[pos])) {
        value += source[pos];
        pos++;
        column++;
      }
      const type = keywords.has(value as typeof KEYWORDS[number]) ? 'KEYWORD' : 'IDENTIFIER';
      tokens.push({ type, value, line, column });
      continue;
    }

    // Relative imports
    if (char === '.') {
      if (source.slice(pos, pos + 2) === './') {
        tokens.push({ type: 'RELATIVE', value: './', line, column });
        pos += 2;
        column += 2;
        continue;
      }
      if (source.slice(pos, pos + 3) === '../') {
        tokens.push({ type: 'RELATIVE', value: '../', line, column });
        pos += 3;
        column += 3;
        continue;
      }
    }

    // Operators: try longest matches first (greedy)
    let operatorFound = false;
    for (const op of OPERATORS_BY_LENGTH) {
      if (source.slice(pos, pos + op.length) === op) {
        tokens.push({ type: 'OPERATOR', value: op, line, column });
        pos += op.length;
        column += op.length;
        operatorFound = true;
        break;
      }
    }
    if (operatorFound) continue;

    // Punctuation
    if (punctuation.has(char)) {
      tokens.push({ type: 'PUNCTUATION', value: char, line, column });
      pos++;
      column++;
      continue;
    }

    // Unknown character - emit ERROR token
    tokens.push({
      type: 'ERROR',
      value: char,
      line,
      column,
      message: `Unexpected character '${char}'`,
    });
    pos++;
    column++;
  }

  // Emit remaining DEDENT tokens at EOF
  while (indentStack.length > 1) {
    indentStack.pop();
    tokens.push({ type: 'DEDENT', value: '', line, column });
  }

  tokens.push({ type: 'EOF', value: '', line, column });
  return tokens;
}
