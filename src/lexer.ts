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
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export const KEYWORDS = [
  'fn', 'let', 'mut', 'public', 'internal', 'match', 'when',
  'import', 'type', 'if', 'then', 'else', 'try', 'catch', 'async', 'await',
  'true', 'false', 'None', 'as', 'in', 'for',
  'where', 'return', 'yield', 'throw', 'break', 'continue', 'loop',
] as const;

export const OPERATORS = [
  '+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=',
  '&&', '||', '!', '=', '+=', '-=', '*=', '/=', '|>', '++', '--',
  '..', '::', '??', '??=', '->', '=>', '..', '...',
] as const;

export const PUNCTUATION = [
  '(', ')', '[', ']', '{', '}', ',', ':', ';', '.', '|',
] as const;

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  const keywords = new Set(KEYWORDS);
  const operators = new Set<string>(OPERATORS);
  const punctuation = new Set<string>(PUNCTUATION);

  while (pos < source.length) {
    const char = source[pos];

    if (/\s/.test(char)) {
      if (char === '\n') {
        tokens.push({ type: 'NEWLINE', value: '\n', line, column });
        line++;
        column = 1;
      } else {
        column++;
      }
      pos++;
      continue;
    }

    if (char === '#') {
      while (pos < source.length && source[pos] !== '\n') {
        pos++;
      }
      continue;
    }

    if (char === '"') {
      if (source.slice(pos, pos + 3) === '"""') {
        const end = source.indexOf('"""', pos + 3);
        const value = source.slice(pos + 3, end);
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
        tokens.push({ type: 'STRING', value, line, column });
        pos++;
      }
      continue;
    }

    if (/\d/.test(char)) {
      let value = '';
      while (pos < source.length && /[\d.]/.test(source[pos])) {
        value += source[pos];
        pos++;
        column++;
      }
      tokens.push({ type: 'NUMBER', value, line, column });
      continue;
    }

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

    // Handle relative paths ./ and ../
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

    const twoChar = source.slice(pos, pos + 2);
    if (operators.has(twoChar)) {
      tokens.push({ type: 'OPERATOR', value: twoChar, line, column });
      pos += 2;
      column += 2;
      continue;
    }

    if (operators.has(char)) {
      tokens.push({ type: 'OPERATOR', value: char, line, column });
      pos++;
      column++;
      continue;
    }

    if (punctuation.has(char)) {
      tokens.push({ type: 'PUNCTUATION', value: char, line, column });
      pos++;
      column++;
      continue;
    }

    pos++;
    column++;
  }

  tokens.push({ type: 'EOF', value: '', line, column });
  return tokens;
}
