export type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'INTERPOLATED_STRING'
  | 'DECORATOR'
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
  'import', 'type', 'enum', 'typeclass', 'impl', 'for', 'async', 'await',
  'as', 'in', 'while',
  'where', 'return', 'break', 'continue',
] as const;

const OPERATOR_CHAR_RE = /^[+\-*/%=!<>&|^~?.$]$/;
const RESERVED_OPERATOR_SYMBOLS = new Set(['./', '../', '|', '->', '=>', '=']);

export const PUNCTUATION = [
  '(', ')', '[', ']', '{', '}', ',', ':', ';', '|',
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

export function isOperatorSymbolChar(char: string): boolean {
  return OPERATOR_CHAR_RE.test(char);
}

export function isValidOperatorSymbol(symbol: string): boolean {
  if (symbol.length === 0) return false;
  if (RESERVED_OPERATOR_SYMBOLS.has(symbol)) return false;
  return [...symbol].every(isOperatorSymbolChar);
}

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

/** Extract custom operator symbols declared via @Operator("symbol", ...) in raw source. */
export function extractCustomOperatorSymbols(source: string): string[] {
  const symbols: string[] = [];
  const re = /@Operator\s*\(\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    symbols.push(m[1]);
  }
  return symbols;
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  const keywords = new Set(KEYWORDS);
  const punctuation = new Set<string>(PUNCTUATION);
  
  // Indentation tracking
  const indentStack: number[] = [0];
  let atLineStart = true;
  let currentLineIndent = 0;
  let bracketDepth = 0; // No INDENT/DEDENT inside brackets (like Python)

  const emitIndentTokens = (newIndent: number) => {
    if (bracketDepth > 0) return;
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
        let hasInterpolation = false;
        const stringStart = pos;
        
        while (pos < source.length) {
          if (source[pos] === '\\' && pos + 1 < source.length) {
            // Handle escape sequence
            value += source[pos];
            value += source[pos + 1];
            pos += 2;
            column += 2;
          } else if (source[pos] === '$' && source[pos + 1] === '{') {
            hasInterpolation = true;
            // Add the ${ to value
            value += source[pos];
            value += source[pos + 1];
            pos += 2;
            column += 2;
            
            // Now we need to find the matching closing brace, accounting for strings
            let braceDepth = 1;
            let inString = false;
            let stringDelimiter = '';
            
            while (pos < source.length && braceDepth > 0) {
              // Handle string delimiters inside the expression
              if ((source[pos] === '"' || source[pos] === "'") && (pos === 0 || source[pos - 1] !== '\\')) {
                if (!inString) {
                  inString = true;
                  stringDelimiter = source[pos];
                } else if (source[pos] === stringDelimiter) {
                  inString = false;
                }
              }
              
              // Only count braces when not inside a string
              if (!inString) {
                if (source[pos] === '{') braceDepth++;
                else if (source[pos] === '}') braceDepth--;
              }
              
              value += source[pos];
              pos++;
              column++;
            }
            // Continue reading the rest of the string after the interpolation
            continue;
          } else if (source[pos] === '"') {
            break;
          } else {
            value += source[pos];
            pos++;
            column++;
          }
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
        
        // If has interpolation, emit as INTERPOLATED_STRING
        if (hasInterpolation) {
          tokens.push({ type: 'INTERPOLATED_STRING', value, line, column: stringStartCol });
        } else {
          tokens.push({ type: 'STRING', value: processEscapeSequences(value), line, column });
        }
        
        if (source[pos] === '"') {
          pos++;
          column++;
        }
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

    // Decorators/annotations: @Name
    if (char === '@' && /[a-zA-Z_]/.test(source[pos + 1] || '')) {
      const tokenColumn = column;
      pos++;
      column++;
      let value = '';
      while (pos < source.length && /[a-zA-Z0-9_]/.test(source[pos])) {
        value += source[pos];
        pos++;
        column++;
      }
      tokens.push({ type: 'DECORATOR', value, line, column: tokenColumn });
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

      const prevChar = pos > 0 ? source[pos - 1] : '';
      const nextChar = pos + 1 < source.length ? source[pos + 1] : '';
      const isTightMemberAccess = /\S/.test(prevChar) && /[a-zA-Z_]/.test(nextChar) && !/[0-9]/.test(prevChar);

      if (isTightMemberAccess) {
        tokens.push({ type: 'PUNCTUATION', value: '.', line, column });
        pos++;
        column++;
        continue;
      }
    }

    // Single '|' is structural punctuation (list/pattern separator).
    // Multi-char operator sequences starting with '|' remain operators.
    if (char === '|' && !isOperatorSymbolChar(source[pos + 1] || '')) {
      tokens.push({ type: 'PUNCTUATION', value: '|', line, column });
      pos++;
      column++;
      continue;
    }

    // Operators: greedily consume contiguous operator symbols.
    if (isOperatorSymbolChar(char)) {
      const start = pos;
      while (pos < source.length && isOperatorSymbolChar(source[pos])) {
        pos++;
        column++;
      }
      tokens.push({ type: 'OPERATOR', value: source.slice(start, pos), line, column: column - (pos - start) });
      continue;
    }

    // Punctuation
    if (punctuation.has(char)) {
      if (char === '(' || char === '[' || char === '{') bracketDepth++;
      else if (char === ')' || char === ']' || char === '}') bracketDepth--;
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
