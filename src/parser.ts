import { tokenize, isValidOperatorSymbol, Token, TokenType } from './lexer.js';
import type {
  Node,
  Program,
  NumberLiteral,
  StringLiteral,
  StringInterpolation,
  StringPart,
  ExprPart,
  BooleanLiteral,
  NoneLiteral,
  Identifier,
  BinaryExpr,
  UnaryExpr,
  CallExpr,
  IndexExpr,
  MemberExpr,
  FunctionExpr,
  FunctionDecl,
  LetDecl,
  IfExpr,
  MatchExpr,
  MatchArm,
  RecordLiteral,
  ListLiteral,
  ListComprehension,
  TupleLiteral,
  PipeExpr,
  BlockExpr,
  ReturnExpr,
  AwaitExpr,
  ImportStmt,
  TypeDecl,
  TypeclassDecl,
  InstanceDecl,
  MethodDecl,
  MethodImpl,
  Constraint,
  ForExpr,
  WhileExpr,
  BreakExpr,
  ContinueExpr,
  Decorator,
  Param,
  Pattern,
  Guard,
} from './ast.js';

export interface OperatorInfo {
  precedence: number;
  associativity: 'left' | 'right' | 'none';
  kind: 'infix' | 'prefix' | 'suffix';
  fnName?: string;
}

class Parser {
  private tokens: Token[] = [];
  private pos = 0;
  private customOperators: Map<string, OperatorInfo> = new Map();

  getCustomOperators(): Map<string, OperatorInfo> {
    return this.customOperators;
  }

  setCustomOperators(ops: Map<string, OperatorInfo>): void {
    for (const [sym, info] of ops) {
      this.customOperators.set(sym, info);
    }
  }

  parse(source: string): Program {
    this.tokens = tokenize(source);
    this.pos = 0;
    this.preScanOperators();
    const body = this.parseBody();
    return { type: 'Program', body };
  }

  /** Scans token stream for @Operator("sym", assoc, prec) before fn declarations
   *  and populates customOperators so the expression parser knows their precedence. */
  private preScanOperators(): void {
    for (let i = 0; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.type !== 'DECORATOR' || t.value !== 'Operator') continue;

      // Expect: ( STRING , STRING , NUMBER )
      let j = i + 1;
      while (j < this.tokens.length && this.tokens[j].type === 'NEWLINE') j++;
      if (this.tokens[j]?.value !== '(') continue;
      j++;
      while (j < this.tokens.length && this.tokens[j].type === 'NEWLINE') j++;

      const symToken = this.tokens[j];
      if (symToken?.type !== 'STRING') continue;
      j++;
      while (j < this.tokens.length && this.tokens[j].type === 'NEWLINE') j++;
      if (this.tokens[j]?.value !== ',') continue;
      j++;
      while (j < this.tokens.length && this.tokens[j].type === 'NEWLINE') j++;

      const assocToken = this.tokens[j];
      if (assocToken?.type !== 'STRING') continue;
      j++;
      while (j < this.tokens.length && this.tokens[j].type === 'NEWLINE') j++;
      if (this.tokens[j]?.value !== ',') continue;
      j++;
      while (j < this.tokens.length && this.tokens[j].type === 'NEWLINE') j++;

      const precToken = this.tokens[j];
      if (precToken?.type !== 'NUMBER') continue;
      j++;
      while (j < this.tokens.length && this.tokens[j].type === 'NEWLINE') j++;
      if (this.tokens[j]?.value !== ')') continue;

      // Skip ahead to find fn name
      j++;
      while (j < this.tokens.length && (this.tokens[j].type === 'NEWLINE' || this.tokens[j].type === 'INDENT' || this.tokens[j].type === 'DEDENT')) j++;
      const visOrFn = this.tokens[j];
      if (visOrFn?.type === 'KEYWORD' && (visOrFn.value === 'public' || visOrFn.value === 'internal' || visOrFn.value === 'private')) j++;
      while (j < this.tokens.length && this.tokens[j].type === 'NEWLINE') j++;
      if (this.tokens[j]?.type === 'KEYWORD' && this.tokens[j].value === 'async') j++;
      while (j < this.tokens.length && this.tokens[j].type === 'NEWLINE') j++;
      if (this.tokens[j]?.type !== 'KEYWORD' || this.tokens[j].value !== 'fn') continue;
      j++;
      while (j < this.tokens.length && this.tokens[j].type === 'NEWLINE') j++;
      const fnNameToken = this.tokens[j];
      if (fnNameToken?.type !== 'IDENTIFIER') continue;

      const sym = symToken.value;
      if (!isValidOperatorSymbol(sym)) {
        throw new Error(`Invalid operator symbol \"${sym}\" in @Operator decorator at ${symToken.line}:${symToken.column}`);
      }
      const assocRaw = assocToken.value.toLowerCase();
      const prec = Number(precToken.value);
      const kind: 'infix' | 'prefix' | 'suffix' =
        assocRaw.startsWith('prefix') ? 'prefix' :
        assocRaw.startsWith('suffix') ? 'suffix' :
        'infix';
      const associativity: 'left' | 'right' | 'none' =
        assocRaw === 'infixr' ? 'right' :
        assocRaw === 'infixl' ? 'left' :
        'none';

      this.customOperators.set(sym, { precedence: prec, associativity, kind, fnName: fnNameToken.value });
    }
  }

  private current(): Token {
    return this.tokens[this.pos] || { type: 'EOF', value: '', line: 0, column: 0 };
  }

  private peek(offset = 1): Token {
    return this.tokens[this.pos + offset] || { type: 'EOF', value: '', line: 0, column: 0 };
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.current();
    if (token.type !== type || (value && token.value !== value)) {
      throw new Error(`Expected ${type}${value ? ` "${value}"` : ''}, got ${token.type} "${token.value}" at ${token.line}:${token.column}`);
    }
    return this.advance();
  }

  private skipNewlines(): void {
    while (this.current().type === 'NEWLINE') {
      this.advance();
    }
  }

  private parseBody(): Node[] {
    const body: Node[] = [];
    this.skipNewlines();
    while (this.current().type !== 'EOF') {
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }
    return body;
  }

  private parseStatement(): Node | null {
    this.skipNewlines();
    const decorators = this.parseDecorators();
    const token = this.current();

    if (token.type === 'KEYWORD') {
      switch (token.value) {
        case 'fn':
          return this.parseFunctionDecl(decorators);
        case 'async':
          return this.parseAsyncFunctionDecl(decorators);
        case 'let':
          if (decorators.length > 0) {
            throw new Error('Decorators are currently only supported on function declarations');
          }
          return this.parseLetDecl();
        case 'type':
          if (decorators.length > 0) {
            throw new Error('Decorators are currently only supported on function declarations');
          }
          return this.parseTypeDecl();
        case 'typeclass':
          if (decorators.length > 0) {
            throw new Error('Decorators are currently only supported on function declarations');
          }
          return this.parseTypeclassDecl();
        case 'impl':
          if (decorators.length > 0) {
            throw new Error('Decorators are currently only supported on function declarations');
          }
          return this.parseInstanceDecl();
        case 'import':
          if (decorators.length > 0) {
            throw new Error('Decorators are currently only supported on function declarations');
          }
          return this.parseImportStmt();
        case 'public':
        case 'internal':
          return this.parseVisibilityStatement(decorators);
        case 'for':
          if (decorators.length > 0) {
            throw new Error('Decorators are currently only supported on function declarations');
          }
          return this.parseFor();
        case 'while':
          if (decorators.length > 0) {
            throw new Error('Decorators are currently only supported on function declarations');
          }
          return this.parseWhile();
        case 'break':
          if (decorators.length > 0) {
            throw new Error('Decorators are currently only supported on function declarations');
          }
          return this.parseBreak();
        case 'continue':
          if (decorators.length > 0) {
            throw new Error('Decorators are currently only supported on function declarations');
          }
          return this.parseContinue();
      }
    }

    if (decorators.length > 0) {
      throw new Error('Decorators must be followed by a function declaration');
    }

    return this.parseExpr();
  }

  private parseAsyncFunctionDecl(decorators: Decorator[] = []): FunctionDecl {
    this.advance(); // consume 'async'
    const fn = this.parseFunctionDecl(decorators);
    fn.isAsync = true;
    return fn;
  }

  private parseVisibilityStatement(decorators: Decorator[] = []): Node {
    const visibility = this.advance().value as 'public' | 'internal';
    if (this.current().value === 'fn') {
      const fn = this.parseFunctionDecl(decorators);
      (fn as FunctionDecl).visibility = visibility;
      return fn;
    }
    if (this.current().value === 'async') {
      const fn = this.parseAsyncFunctionDecl(decorators);
      fn.visibility = visibility;
      return fn;
    }
    throw new Error(`Expected 'fn' after visibility modifier`);
  }

  private parseFunctionDecl(decorators: Decorator[] = []): FunctionDecl {
    // Consume 'fn' if present (not present when called from parseAsyncFunctionDecl)
    if (this.current().value === 'fn') {
      this.advance();
    }
    
    const isAsync = this.current().value === 'async';
    if (isAsync) this.advance();

    const nameToken = this.expect('IDENTIFIER');
    const name = nameToken.value;

    let params: Param[] = [];
    
    // Check if function has parentheses or is an operator function
    if (this.current().value === '(') {
      params = this.parseParams();
    }
    
    let returnType: Node | undefined;

    if (this.current().value === '->') {
      this.advance();
      returnType = this.parseType();
    }

    // Parse optional where constraints
    let constraints: Constraint[] | undefined;
    if (this.current().value === 'where') {
      this.advance();
      constraints = this.parseConstraints();
    }

    this.skipNewlines();
    this.expect('OPERATOR', '=');
    this.skipNewlines();
    
    let body: Node;
    
    // Check if body is multi-line (starts with INDENT) or a keyword that needs block context
    if (this.current().type === 'INDENT' || 
        (this.current().type === 'KEYWORD' && ['let', 'if', 'match'].includes(this.current().value))) {
      body = this.parseBlockBody();
    } else {
      body = this.parseExpr();
    }

    // If no params but body is operator function, extract params from body
    if (params.length === 0 && body.type === 'FunctionExpr') {
      const fnBody = body as FunctionExpr;
      params = fnBody.params;
    }

    return {
      type: 'FunctionDecl',
      name,
      params,
      body,
      returnType,
      constraints,
      decorators,
      visibility: 'private',
      isAsync,
    };
  }

  private parseDecorators(): Decorator[] {
    const decorators: Decorator[] = [];

    while (this.current().type === 'DECORATOR') {
      const token = this.advance();
      const args: Node[] = [];

      if (this.current().value === '(') {
        this.advance();
        this.skipNewlines();
        while (this.current().value !== ')') {
          args.push(this.parseExpr());
          this.skipNewlines();
          if (this.current().value === ',') {
            this.advance();
            this.skipNewlines();
          } else {
            break;
          }
        }
        this.expect('PUNCTUATION', ')');
      }

      decorators.push({
        type: 'Decorator',
        name: token.value,
        args,
        line: token.line,
        column: token.column,
      });

      this.skipNewlines();
    }

    return decorators;
  }
  
  private parseBlockBody(): BlockExpr {
    const body: Node[] = [];
    
    // Skip newlines first, then consume INDENT if present (multi-line block)
    this.skipNewlines();
    if (this.current().type === 'INDENT') {
      this.advance();
    }
    
    while (this.current().type !== 'EOF' && this.current().type !== 'DEDENT' && this.current().value !== '}') {
      this.skipNewlines();
      
      // Stop at DEDENT (end of block)
      if (this.current().type === 'DEDENT') {
        break;
      }
      
      // Stop at new function declarations at top level
      if (this.current().type === 'KEYWORD' && ['fn', 'async', 'type', 'import', 'public', 'internal'].includes(this.current().value)) {
        break;
      }
      
      // Use parseStatement() to handle let, for, while, break, continue, etc.
      if (this.current().type !== 'EOF' && this.current().type !== 'DEDENT') {
        const stmt = this.parseStatement();
        if (stmt !== null) {
          body.push(stmt);
        }
      }
      
      this.skipNewlines();
    }
    
    // Consume DEDENT if present
    if (this.current().type === 'DEDENT') {
      this.advance();
    }
    
    return { type: 'BlockExpr', body } as BlockExpr;
  }

  private parseParams(): Param[] {
    const params: Param[] = [];
    this.expect('PUNCTUATION', '(');
    
    while (this.current().value !== ')') {
      const name = this.expect('IDENTIFIER').value;
      let paramType: Node | undefined;
      
      if (this.current().type === 'IDENTIFIER' || this.current().type === 'KEYWORD') {
        paramType = this.parseType();
      }

      params.push({ type: 'Param', name, paramType });
      
      if (this.current().value === ',') this.advance();
    }

    this.expect('PUNCTUATION', ')');
    this.skipNewlines();
    return params;
  }

  private parseLetDecl(): LetDecl {
    this.advance(); // consume 'let'
    const isMutable = this.current().value === 'mut';
    if (isMutable) this.advance();

    const pattern = this.parsePattern();
    let value: Node | null = null;

    if (this.current().value === '=') {
      this.advance();
      value = this.parseExpr();
    }

    return { type: 'LetDecl', pattern, value: value!, isMutable };
  }

  private parsePattern(): Pattern {
    const token = this.current();

    if (token.value === '{') {
      return this.parseRecordPattern();
    }

    if (token.value === '[') {
      return this.parseListPattern();
    }

    if (token.value === '(') {
      return this.parseTuplePattern();
    }

    if (token.type === 'IDENTIFIER' && /^[A-Z]/.test(token.value)) {
      return this.parseConstructorPattern();
    }

    if (token.value === '_') {
      this.advance();
      return { type: 'WildcardPattern' };
    }

    if (token.type === 'NUMBER') {
      this.advance();
      return { type: 'LiteralPattern', literal: { type: 'NumberLiteral', value: parseInt(token.value, 10) } };
    }

    if (token.type === 'STRING') {
      this.advance();
      return { type: 'LiteralPattern', literal: { type: 'StringLiteral', value: token.value } };
    }

    const identifier = this.expect('IDENTIFIER');
    if (this.current().value === 'as') {
      this.advance();
      const as = this.expect('IDENTIFIER');
      return { type: 'IdentifierPattern', name: identifier.value, as: as.value };
    }
    return { type: 'IdentifierPattern', name: identifier.value };
  }

  private parseRecordPattern(): { type: 'RecordPattern'; fields: { key: string; pattern: Pattern; defaultValue?: Node }[]; rest?: string } {
    this.expect('PUNCTUATION', '{');
    const fields: { key: string; pattern: Pattern; defaultValue?: Node }[] = [];

    while (this.current().value !== '}') {
      const key = this.expect('IDENTIFIER').value;
      let pattern: Pattern = { type: 'IdentifierPattern', name: key };
      let defaultValue: Node | undefined;

      if (this.current().value === ':') {
        this.advance();
        pattern = this.parsePattern();
      }

      if (this.current().value === 'as') {
        this.advance();
        const as = this.expect('IDENTIFIER');
        pattern = { type: 'IdentifierPattern', name: key, as: as.value };
      }

      if (this.current().value === '??') {
        this.advance();
        defaultValue = this.parseExpr();
      }

      fields.push({ key, pattern, defaultValue });

      if (this.current().value === ',') this.advance();
    }

    this.expect('PUNCTUATION', '}');
    return { type: 'RecordPattern', fields };
  }

  private parseListPattern(): { type: 'ListPattern'; elements: Pattern[]; rest?: string } {
    this.expect('PUNCTUATION', '[');
    const elements: Pattern[] = [];

    while (this.current().value !== ']') {
      if (this.current().value === '|') {
        this.advance();
        const rest = this.expect('IDENTIFIER').value;
        this.expect('PUNCTUATION', ']');
        return { type: 'ListPattern', elements, rest };
      }
      elements.push(this.parsePattern());
      if (this.current().value === ',') this.advance();
    }

    this.expect('PUNCTUATION', ']');
    return { type: 'ListPattern', elements };
  }

  private parseTuplePattern(): { type: 'TuplePattern'; elements: Pattern[] } {
    this.expect('PUNCTUATION', '(');
    const elements: Pattern[] = [];

    while (this.current().value !== ')') {
      elements.push(this.parsePattern());
      if (this.current().value === ',') this.advance();
    }

    this.expect('PUNCTUATION', ')');
    return { type: 'TuplePattern', elements };
  }

  private parseConstructorPattern(): { type: 'ConstructorPattern'; name: string; patterns: Pattern[] } {
    const name = this.expect('IDENTIFIER').value;
    const patterns: Pattern[] = [];

    if (this.current().value === '(') {
      this.advance();
      while (this.current().value !== ')') {
        const pattern = this.parsePattern();
        if (this.current().value === ':') {
          this.advance();
          this.parseType();
        }
        patterns.push(pattern);
        if (this.current().value === ',') this.advance();
      }
      this.expect('PUNCTUATION', ')');
    }

    return { type: 'ConstructorPattern', name, patterns };
  }

  private parseTypeDecl(): TypeDecl {
    this.advance(); // consume 'type'
    const name = this.expect('IDENTIFIER').value;
    const typeParams: string[] = [];
    let constraints: Constraint[] | undefined;

    if (this.current().value === '(') {
      this.advance();
      while (this.current().value !== ')') {
        typeParams.push(this.expect('IDENTIFIER').value);
        if (this.current().value === ',') this.advance();
      }
      this.expect('PUNCTUATION', ')');
    }

    const variants: TypeDecl['variants'] = [];

    if (this.current().value === '=') {
      this.advance();
      let isRecord = false;
      const recordFields: { name: string; fieldType: Node; default?: Node }[] = [];

      if (this.current().value === '{') {
        isRecord = true;
        this.advance();
        while (this.current().value !== '}') {
          const fieldName = this.expect('IDENTIFIER').value;
          let fieldType = this.parseType();
          let defaultValue: Node | undefined;

          if (this.current().value === '??') {
            this.advance();
            defaultValue = this.parseExpr();
          }

          recordFields.push({ name: fieldName, fieldType, default: defaultValue });
          if (this.current().value === ',') this.advance();
        }
        this.expect('PUNCTUATION', '}');

        if (this.current().value === 'where') {
          this.advance();
          constraints = this.parseConstraints();
        }
      } else {
        while (this.current().type !== 'NEWLINE' && this.current().type !== 'EOF' && this.current().value !== 'where') {
          const variantName = this.expect('IDENTIFIER').value;
          const fields: { name: string; fieldType: Node }[] = [];

          if (this.current().value === '(') {
            this.advance();
            while (this.current().value !== ')') {
              let fieldName = '';
              let fieldType: Node = { type: 'Identifier', name: 'any' } as Identifier;
              
              if (this.current().type === 'IDENTIFIER') {
                const firstIdent = this.expect('IDENTIFIER').value;
                if (this.current().value === ':') {
                  this.advance();
                  fieldName = firstIdent;
                  if (this.current().value !== ')' && this.current().value !== ',') {
                    fieldType = this.parseType();
                  }
                } else {
                  fieldName = firstIdent;
                  if (this.current().value !== ')' && this.current().value !== ',') {
                    fieldType = this.parseType();
                  }
                }
              }
              
              fields.push({ name: fieldName, fieldType });
              if (this.current().value === ',') this.advance();
            }
            this.expect('PUNCTUATION', ')');
          }

          variants.push({ type: 'TypeVariant', name: variantName, fields });
          
          if (this.current().value === '|') this.advance();
          else break;
        }

        if (this.current().value === 'where') {
          this.advance();
          constraints = this.parseConstraints();
        }
      }

      return { type: 'TypeDecl', name, typeParams, constraints, variants, recordFields: isRecord ? recordFields : undefined };
    }

    if (this.current().value === 'where') {
      this.advance();
      constraints = this.parseConstraints();
    }

    return { type: 'TypeDecl', name, typeParams, constraints, variants };
  }

  private parseImportStmt(): ImportStmt {
    this.advance(); // consume 'import'
    
    // Check for relative import (./foo or ../foo)
    let isRelative = false;
    let module = '';
    
    if (this.current().type === 'RELATIVE') {
      isRelative = true;
      module = this.current().value; // './' or '../'
      this.advance();
      
      // Consume the module name after ./ or ../
      if (this.current().type === 'IDENTIFIER') {
        module += this.current().value;
        this.advance();
        // Handle hyphens in module name
        while (this.current().value === '-') {
          module += '-' + this.expect('IDENTIFIER').value;
        }
      }
    } else {
      // Regular module name (may contain hyphens)
      module = this.expect('IDENTIFIER').value;
      // Handle remaining hyphens if any
      while (this.current().value === '-') {
        this.advance();
        module += '-' + this.expect('IDENTIFIER').value;
      }
    }
    
    let alias: string | undefined;
    let items: string[] | undefined;
    let hiding: string[] | undefined;

    if (this.current().value === 'as') {
      this.advance();
      alias = this.expect('IDENTIFIER').value;
    }

    if (this.current().value === '(') {
      this.advance();
      items = [];
      while (this.current().value !== ')') {
        // Handle identifiers that might have hyphens around them
        let itemName = this.expect('IDENTIFIER').value;
        while (this.current().value === '-') {
          this.advance();
          itemName += '-' + this.expect('IDENTIFIER').value;
        }
        items.push(itemName);
        if (this.current().value === ',') this.advance();
      }
      this.expect('PUNCTUATION', ')');
    }

    if (this.current().value === 'hiding') {
      this.advance();
      this.expect('PUNCTUATION', '(');
      hiding = [];
      while (this.current().value !== ')') {
        hiding.push(this.expect('IDENTIFIER').value);
        if (this.current().value === ',') this.advance();
      }
      this.expect('PUNCTUATION', ')');
    }

    return { type: 'ImportStmt', module, isRelative, items, alias, hiding };
  }

  private parseExpr(): Node {
    return this.parsePipe();
  }

  private parseLambdaBody(): Node {
    this.skipNewlines();
    if (
      this.current().type === 'INDENT' ||
      (this.current().type === 'KEYWORD' && ['let', 'if', 'match'].includes(this.current().value))
    ) {
      return this.parseBlockBody();
    }
    return this.parseExpr();
  }

  private parsePipe(): Node {
    let left = this.parseUnary();
    this.skipNewlines();

    while (this.current().value === '|>') {
      this.advance();
      this.skipNewlines();
      const right = this.parseUnary();
      this.skipNewlines();
      left = { type: 'PipeExpr', left, right } as PipeExpr;
    }

    return left;
  }

  private parseUnary(): Node {
    if (this.current().type === 'OPERATOR') {
      const customOperator = this.customOperators.get(this.current().value);
      if (customOperator?.kind === 'prefix') {
        const operator = this.advance().value;
        const operand = this.parseUnary();
        return { type: 'UnaryExpr', operator, operand, position: 'prefix' } as UnaryExpr;
      }

      const operator = this.current().value;
      const next = this.peek();
      const isAdjacent = this.current().line === next.line && this.current().column + operator.length === next.column;
      if (this.isFallbackPrefixOperator(operator) && isAdjacent && this.canStartUnaryOperand(next)) {
        this.advance();
        const operand = this.parseUnary();
        return { type: 'UnaryExpr', operator, operand, position: 'prefix' } as UnaryExpr;
      }
    }
    if (this.current().value === 'await') {
      this.advance();
      const expression = this.parseUnary();
      return { type: 'AwaitExpr', expression } as AwaitExpr;
    }
    return this.parseBinary();
  }

  private parsePostfix(): Node {
    let expr = this.parseCall();

    while (this.current().type === 'OPERATOR') {
      const info = this.customOperators.get(this.current().value);
      if (!info || info.kind !== 'suffix') break;
      const operator = this.advance().value;
      expr = { type: 'UnaryExpr', operator, operand: expr, position: 'suffix' } as UnaryExpr;
    }

    return expr;
  }

  private parseBinary(): Node {
    return this.parseBinaryWithPrecedence(0);
  }

  private parseBinaryWithPrecedence(minPrecedence: number): Node {
    let left = this.parsePostfix();
    this.skipNewlines();

    const precedences: Record<string, number> = {};
    for (const [sym, info] of this.customOperators) {
      if (info.kind === 'infix') {
        precedences[sym] = info.precedence;
      }
    }
    const rightAssociative = new Set<string>();
    for (const [sym, info] of this.customOperators) {
      if (info.kind === 'infix' && info.associativity === 'right') rightAssociative.add(sym);
    }

    // Temporary migration fallback: unknown infix operators still parse with low precedence.
    // Semantic validation can later reject undeclared operators.
    const FALLBACK_INFIX_PRECEDENCE = 1;

    while (true) {
      this.skipNewlines();
      if (this.current().type !== 'OPERATOR') break;
      const operator = this.current().value;
      if (operator === '->' || operator === '=>') break;
      const info = this.customOperators.get(operator);
      if (info && info.kind !== 'infix') break;
      const precedence = info?.precedence ?? precedences[operator] ?? FALLBACK_INFIX_PRECEDENCE;
      if (precedence < minPrecedence) break;

      this.advance();
      this.skipNewlines();
      if (operator === '|>') {
        const right = this.parseCall();
        left = { type: 'PipeExpr', left, right } as PipeExpr;
      } else {
        const isRightAssociative = info?.associativity === 'right' || rightAssociative.has(operator);
        const nextPrecedence = isRightAssociative ? precedence : precedence + 1;
        const right = this.parseBinaryWithPrecedence(nextPrecedence);
        left = { type: 'BinaryExpr', operator, left, right } as BinaryExpr;
      }
    }

    return left;
  }

  private parseCall(): Node {
    let expr = this.parsePrimary();

    while (true) {
      if (this.current().value === '(') {
        this.advance();
        const args: Node[] = [];
        while (this.current().value !== ')') {
          args.push(this.parseExpr());
          if (this.current().value === ',') this.advance();
        }
        this.expect('PUNCTUATION', ')');
        expr = { type: 'CallExpr', callee: expr, args } as CallExpr;
      } else if (this.current().type === 'PUNCTUATION' && this.current().value === '.') {
        this.advance();
        const propertyToken = this.expect('IDENTIFIER');
        const property = { type: 'Identifier' as const, name: propertyToken.value };
        expr = { type: 'MemberExpr', object: expr, property, computed: false } as MemberExpr;
      } else if (this.current().value === '[') {
        this.advance();
        const index = this.parseExpr();
        this.expect('PUNCTUATION', ']');
        expr = { type: 'IndexExpr', object: expr, index } as IndexExpr;
      } else if (this.current().value === '!!') {
        this.advance();
        const index = this.parsePrimary();
        expr = { type: 'IndexExpr', object: expr, index } as IndexExpr;
      } else {
        break;
      }
    }

    return expr;
  }

  private parsePrimary(): Node {
    const token = this.current();

    if (token.type === 'NUMBER') {
      this.advance();
      return { type: 'NumberLiteral', value: parseFloat(token.value) } as NumberLiteral;
    }

    if (token.type === 'STRING') {
      this.advance();
      return { type: 'StringLiteral', value: token.value } as StringLiteral;
    }

    if (token.type === 'INTERPOLATED_STRING') {
      this.advance();
      return this.parseInterpolatedString(token.value);
    }

    if (token.type === 'KEYWORD') {
      if (token.value === 'None') {
        this.advance();
        return { type: 'NoneLiteral' } as NoneLiteral;
      }
      if (token.value === 'fn') {
        return this.parseFunctionExpr();
      }
      if (token.value === 'if') {
        return this.parseIf();
      }
      if (token.value === 'match') {
        return this.parseMatch();
      }
    }

    if (token.value === '[') {
      return this.parseListLiteral();
    }
    if (token.value === '{') {
      return this.parseRecordOrBlock();
    }
    if (token.value === '(') {
      return this.parseTupleOrParens();
    }

    if (token.type === 'IDENTIFIER') {
      this.advance();
      return { type: 'Identifier', name: token.value } as Identifier;
    }

    if (token.type === 'OPERATOR') {
      return this.parseSectionOperator();
    }

    throw new Error(`Unexpected token: ${token.type} "${token.value}" at ${token.line}:${token.column}`);
  }

  private parseInterpolatedString(rawString: string): StringInterpolation {
    const parts: (StringPart | ExprPart)[] = [];
    let currentPart = '';
    let i = 0;

    while (i < rawString.length) {
      if (rawString[i] === '$' && rawString[i + 1] === '{') {
        // Save any accumulated string part
        if (currentPart.length > 0) {
          parts.push({ type: 'StringPart', value: currentPart });
          currentPart = '';
        }

        // Find the matching closing brace, accounting for strings
        i += 2; // skip ${
        let braceDepth = 1;
        let exprStart = i;
        let inString = false;
        let stringDelimiter = '';

        while (i < rawString.length && braceDepth > 0) {
          // Handle string delimiters
          if ((rawString[i] === '"' || rawString[i] === "'") && (i === 0 || rawString[i - 1] !== '\\')) {
            if (!inString) {
              inString = true;
              stringDelimiter = rawString[i];
            } else if (rawString[i] === stringDelimiter) {
              inString = false;
            }
          }

          // Only count braces when not inside a string
          if (!inString) {
            if (rawString[i] === '{') braceDepth++;
            else if (rawString[i] === '}') braceDepth--;
          }

          if (braceDepth > 0) i++;
        }

        const exprCode = rawString.slice(exprStart, i);
        
        // Parse the expression
        const exprTokens = tokenize(exprCode);
        const exprParser = new Parser();
        exprParser.tokens = exprTokens;
        exprParser.pos = 0;
        const expr = exprParser.parseExpr();

        parts.push({ type: 'ExprPart', expr });
        i++; // skip the closing }
      } else if (rawString[i] === '\\' && rawString[i + 1] === '$') {
        // Escaped dollar sign
        currentPart += '$';
        i += 2;
      } else {
        currentPart += rawString[i];
        i++;
      }
    }

    // Add any remaining string part
    if (currentPart.length > 0) {
      parts.push({ type: 'StringPart', value: currentPart });
    }

    return { type: 'StringInterpolation', parts } as StringInterpolation;
  }

  private parseSectionOperator(): Node {
    const operator = this.advance().value;
    
    const savedPos = this.pos;
    const savedToken = this.current();
    
    if (savedToken.type === 'NUMBER' || savedToken.type === 'STRING' || 
      savedToken.type === 'IDENTIFIER' || savedToken.value === 'None') {
      // Use parsePrimary to avoid consuming too much
      const right = this.parsePrimary();
      return { 
        type: 'FunctionExpr', 
        params: [{ type: 'Param', name: '_left', paramType: undefined }],
        body: { type: 'BinaryExpr', operator, left: { type: 'Identifier', name: '_left' }, right }
      } as FunctionExpr;
    }
    
    this.pos = savedPos;
    return { 
      type: 'FunctionExpr', 
      params: [{ type: 'Param', name: '_left', paramType: undefined }, { type: 'Param', name: '_right', paramType: undefined }],
      body: { type: 'BinaryExpr', operator, left: { type: 'Identifier', name: '_left' }, right: { type: 'Identifier', name: '_right' } }
    } as FunctionExpr;
  }

  private canStartUnaryOperand(token: Token): boolean {
    if (token.type === 'NUMBER' || token.type === 'STRING' || token.type === 'INTERPOLATED_STRING' || token.type === 'IDENTIFIER') {
      return true;
    }
    if (token.type === 'KEYWORD') {
      return token.value === 'if' || token.value === 'match' || token.value === 'fn' || token.value === 'None' || token.value === 'await';
    }
    return token.value === '(' || token.value === '[' || token.value === '{';
  }

  private isFallbackPrefixOperator(operator: string): boolean {
    return operator === '!' || operator === '-' || operator === '+' || operator === '~';
  }

  private parseFunctionExpr(): FunctionExpr {
    this.advance(); // consume 'fn'
    
    let params: Param[] = [];
    
    // Check if it's an operator function without parentheses: fn add = (+)
    if (this.current().type === 'OPERATOR') {
      // This is an operator function like fn add = (+)
      // The body will be parsed after '='
    } else {
      params = this.parseParams();
    }
    
    let returnType: Node | undefined;

    if (this.current().value === '->') {
      this.advance();
      returnType = this.parseType();
    }

    // Parse optional where constraints (for function expressions, though less common)
    let constraints: Constraint[] | undefined;
    if (this.current().value === 'where') {
      this.advance();
      constraints = this.parseConstraints();
    }

    this.skipNewlines();
    this.expect('OPERATOR', '=');
    this.skipNewlines();
    const body = this.parseExpr();

    // If no params were defined but body is an operator section, add params
    if (params.length === 0 && body.type === 'FunctionExpr') {
      const fnBody = body as FunctionExpr;
      if (fnBody.params.length === 2) {
        params = fnBody.params;
      }
    }

    return { type: 'FunctionExpr', params, body, returnType };
  }

  private parseIf(): IfExpr {
    this.advance(); // consume 'if'
    const condition = this.parseExpr();
    this.skipNewlines();
    
    // Check if this is a statement-style if (with :) or expression-style if (with then)
    if (this.current().value === ':') {
      // Statement-style if: if condition: body else: else_body
      this.advance(); // consume ':'
      this.skipNewlines();
      const thenBranch = this.parseBlockBody();
      
      // Check for else clause
      let elseBranch: Node = { type: 'BlockExpr', body: [] } as BlockExpr;
      if (this.current().value === 'else') {
        this.advance(); // consume 'else'
        this.skipNewlines();
        if (this.current().value === ':') {
          this.advance(); // consume ':'
          this.skipNewlines();
          elseBranch = this.parseBlockBody();
        } else {
          // else if case
          elseBranch = this.parseIf();
        }
      }
      
      return { type: 'IfExpr', condition, thenBranch, elseBranch };
    } else {
      // Expression-style if: if condition then expr else expr
      this.expect('KEYWORD', 'then');
      this.skipNewlines();
      const thenBranch = this.parseExpr();
      this.skipNewlines();
      this.expect('KEYWORD', 'else');
      this.skipNewlines();
      const elseBranch = this.parseExpr();

      return { type: 'IfExpr', condition, thenBranch, elseBranch };
    }
  }

  private parseMatch(): MatchExpr {
    this.advance(); // consume 'match'
    const value = this.parseExpr();
    this.skipNewlines();
    this.expect('PUNCTUATION', ':');

    const arms: MatchArm[] = [];
    this.skipNewlines();

    // Consume INDENT if present (multi-line arms)
    if (this.current().type === 'INDENT') {
      this.advance();
    }

    while (this.current().type !== 'EOF' && this.current().type !== 'DEDENT') {
      const token = this.current();
      
      // Skip newlines but check what comes after
      if (token.type === 'NEWLINE') {
        this.advance();
        continue;
      }
      
      // Stop at keywords that should not be part of match arms
      if (token.type === 'KEYWORD' && ['fn', 'let', 'type', 'import', 'public', 'internal'].includes(token.value)) {
        break;
      }
      
      // Stop at closing punctuation or argument separator
      if (token.type === 'PUNCTUATION' && (token.value === ')' || token.value === '}' || token.value === ']' || token.value === ',')) {
        break;
      }

      // Parse pattern
      const pattern = this.parsePattern();
      let guard: Guard | undefined;

      if (this.current().value === 'when') {
        this.advance();
        guard = { type: 'Guard', condition: this.parseExpr() } as Guard;
      }

      this.skipNewlines();
      this.expect('OPERATOR', '->');
      this.skipNewlines();
      const armBody = this.parseExpr();

      arms.push({ type: 'MatchArm', pattern, guard, body: armBody });
      this.skipNewlines();
    }

    // Consume DEDENT if present
    if (this.current().type === 'DEDENT') {
      this.advance();
    }

    return { type: 'MatchExpr', value, arms };
  }

  private parseFor(): ForExpr {
    this.advance(); // consume 'for'
    const pattern = this.parsePattern();
    this.expect('KEYWORD', 'in');
    const iterable = this.parseExpr();
    
    let condition: Node | undefined;
    if (this.current().value === 'if') {
      this.advance();
      condition = this.parseExpr();
    }
    
    this.skipNewlines();
    this.expect('PUNCTUATION', ':');
    this.skipNewlines();
    
    const body = this.parseBlockBody();
    
    return {
      type: 'ForExpr',
      pattern,
      iterable,
      condition,
      body,
    } as ForExpr;
  }

  private parseWhile(): WhileExpr {
    this.advance(); // consume 'while'
    const condition = this.parseExpr();
    this.skipNewlines();
    this.expect('PUNCTUATION', ':');
    this.skipNewlines();
    
    const body = this.parseBlockBody();
    
    return {
      type: 'WhileExpr',
      condition,
      body,
    } as WhileExpr;
  }

  private parseBreak(): BreakExpr {
    this.advance(); // consume 'break'
    return { type: 'BreakExpr' } as BreakExpr;
  }

  private parseContinue(): ContinueExpr {
    this.advance(); // consume 'continue'
    return { type: 'ContinueExpr' } as ContinueExpr;
  }

  private parseListLiteral(): Node {
    this.advance(); // consume '['

    // Empty list
    if (this.current().value === ']') {
      this.advance();
      return { type: 'ListLiteral', elements: [] } as ListLiteral;
    }

    // Tail-only sugar: [|xs] desugars to xs
    if (this.current().value === '|') {
      this.advance();
      const rest = this.parseExpr();
      this.expect('PUNCTUATION', ']');
      return rest;
    }

    // Parse first element
    const firstElement = this.parseExpr();

    // Check for list comprehension: [expr for pattern in iterable if condition?]
    if (this.current().value === 'for') {
      return this.parseListComprehension(firstElement);
    }

    // Otherwise, parse as list literal
    const elements: Node[] = [firstElement];

    while (this.current().value !== ']') {
      if (this.current().value === '|') {
        this.advance();
        const rest = this.parseExpr();
        this.expect('PUNCTUATION', ']');
        let acc: Node = rest;
        for (let i = elements.length - 1; i >= 0; i--) {
          acc = {
            type: 'CallExpr',
            callee: { type: 'Identifier', name: 'Cons' } as Identifier,
            args: [elements[i], acc],
          } as CallExpr;
        }
        return acc;
      }
      if (this.current().value === ',') {
        this.advance();
      }
      elements.push(this.parseExpr());
    }

    this.expect('PUNCTUATION', ']');
    return { type: 'ListLiteral', elements } as ListLiteral;
  }

  private parseListComprehension(element: Node): ListComprehension {
    this.advance(); // consume 'for'
    const pattern = this.parsePattern();
    this.expect('KEYWORD', 'in');
    const iterable = this.parseExpr();

    let condition: Node | undefined;
    if (this.current().value === 'if') {
      this.advance();
      condition = this.parseExpr();
    }

    this.expect('PUNCTUATION', ']');

    return {
      type: 'ListComprehension',
      element,
      pattern,
      iterable,
      condition,
    } as ListComprehension;
  }

  private parseRecordOrBlock(): Node {
    const saved = this.pos;
    this.advance(); // consume '{'
    this.skipNewlines();

    // Check if it's a record (has key: value pairs) or a block
    const firstToken = this.current();
    if (firstToken.value === '}') {
      // Empty block/record
    } else if (firstToken.type === 'KEYWORD' || firstToken.value === 'let') {
      // Block starts with keyword (let, if, match, etc.)
      this.pos = saved;
      return this.parseBlock();
    } else if (firstToken.type === 'IDENTIFIER') {
      const key = this.advance().value;
      if (this.current().value !== ':') {
        this.pos = saved;
        return this.parseBlock();
      }
      // It's a record
      this.pos = saved;
      return this.parseRecordLiteral();
    }

    this.pos = saved;
    return this.parseRecordLiteral();
  }

  private parseRecordLiteral(): RecordLiteral {
    this.advance(); // consume '{'
    const fields: { key: string; value: Node }[] = [];

    while (this.current().value !== '}') {
      const key = this.expect('IDENTIFIER').value;
      this.expect('PUNCTUATION', ':');
      const value = this.parseExpr();
      fields.push({ key, value });
      if (this.current().value === ',') this.advance();
    }

    this.expect('PUNCTUATION', '}');
    return { type: 'RecordLiteral', fields };
  }

  private parseBlock(): BlockExpr {
    this.advance(); // consume '{'
    const body: Node[] = [];

    while (this.current().value !== '}') {
      this.skipNewlines();
      if (this.current().value === '}') break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    this.expect('PUNCTUATION', '}');
    return { type: 'BlockExpr', body };
  }

  private parseTupleOrParens(): Node {
    this.advance(); // consume '('
    
    // Empty parens: () -> body is zero-param lambda, () is empty tuple
    if (this.current().value === ')') {
      this.advance(); // consume ')'
      if (this.current().value === '->') {
        this.advance(); // consume '->'
        const body = this.parseLambdaBody();
        return { type: 'FunctionExpr', params: [], body } as FunctionExpr;
      }
      return { type: 'TupleLiteral', elements: [] } as TupleLiteral;
    }

    // Check for operator section: (op), (op arg), (arg op)
    if (this.current().type === 'OPERATOR') {
      return this.parseOperatorSection();
    }

    // Speculatively try to parse as lambda: (params) -> body
    // This handles typed params like (x Int, y Int) -> x + y
    const savedPos = this.pos;
    try {
      const params = this.parseLambdaParams();
      this.expect('PUNCTUATION', ')');
      if (this.current().value === '->') {
        this.advance(); // consume '->'
        const body = this.parseLambdaBody();
        return { type: 'FunctionExpr', params, body } as FunctionExpr;
      }
      // Not a lambda — reset and parse normally
      this.pos = savedPos;
    } catch (e) {
      this.pos = savedPos;
    }

    // Try to parse as left-argument operator section: (expr op)
    const savedPos2 = this.pos;
    try {
      const first = this.parsePrimary();
      
      if (this.current().type === 'OPERATOR' && this.peek(1).value === ')') {
        const operator = this.current().value;
        this.advance();
        this.expect('PUNCTUATION', ')');
        
        const param: Param = { type: 'Param', name: '_x', paramType: undefined };
        const body: BinaryExpr = {
          type: 'BinaryExpr',
          left: first,
          operator,
          right: { type: 'Identifier', name: '_x' } as Identifier
        };
        return { type: 'FunctionExpr', params: [param], body } as FunctionExpr;
      }
      
      this.pos = savedPos2;
    } catch (e) {
      this.pos = savedPos2;
    }

    // Normal tuple or parenthesized expression
    const first = this.parseExpr();

    if (this.current().value === ',') {
      this.advance();
      const elements: Node[] = [first];
      while (this.current().value !== ')') {
        elements.push(this.parseExpr());
        if (this.current().value === ',') this.advance();
      }
      this.expect('PUNCTUATION', ')');
      return { type: 'TupleLiteral', elements } as TupleLiteral;
    }

    this.expect('PUNCTUATION', ')');
    return first;
  }

  private parseLambdaParams(): Param[] {
    const params: Param[] = [];
    while (this.current().value !== ')') {
      const name = this.expect('IDENTIFIER').value;
      let paramType: Node | undefined;
      if (this.current().type === 'IDENTIFIER' || this.current().type === 'KEYWORD') {
        paramType = this.parseType();
      }
      params.push({ type: 'Param', name, paramType });
      if (this.current().value === ',') this.advance();
    }
    return params;
  }

  private parseOperatorSection(): Node {
    // We're already past '(' and at an OPERATOR token
    const operator = this.current().value;
    this.advance();

    if (this.current().value === ')') {
      // Binary operator: (+), (-), etc.
      this.advance();
      const params: Param[] = [
        { type: 'Param', name: '_a', paramType: undefined },
        { type: 'Param', name: '_b', paramType: undefined }
      ];
      const body: BinaryExpr = {
        type: 'BinaryExpr',
        left: { type: 'Identifier', name: '_a' } as Identifier,
        operator,
        right: { type: 'Identifier', name: '_b' } as Identifier
      };
      return { type: 'FunctionExpr', params, body } as FunctionExpr;
    }

    // Unary operator with right argument: (* 2), (> 0), etc.
    const right = this.parsePrimary();
    this.expect('PUNCTUATION', ')');

    const param: Param = { type: 'Param', name: '_x', paramType: undefined };
    const body: BinaryExpr = {
      type: 'BinaryExpr',
      left: { type: 'Identifier', name: '_x' } as Identifier,
      operator,
      right
    };
    return { type: 'FunctionExpr', params: [param], body } as FunctionExpr;
  }

  private parseType(): Node {
    const token = this.current();
    
    if (token.type === 'IDENTIFIER') {
      this.advance();
      const name = token.value;
      
      if (this.current().value === '(') {
        this.advance();
        const args: Node[] = [];
        while (this.current().value !== ')') {
          args.push(this.parseType());
          if (this.current().value === ',') this.advance();
        }
        this.expect('PUNCTUATION', ')');
        return { type: 'CallExpr', callee: { type: 'Identifier', name }, args } as CallExpr;
      }
      
      return { type: 'Identifier', name } as Identifier;
    }

    throw new Error(`Expected type, got ${token.type} "${token.value}"`);
  }

  private parseTypeclassDecl(): TypeclassDecl {
    this.advance(); // consume 'typeclass'
    const name = this.expect('IDENTIFIER').value;
    const typeParams: string[] = [];

    // Parse type parameters: (a), (a, b), etc.
    if (this.current().value === '(') {
      this.advance();
      while (this.current().value !== ')') {
        typeParams.push(this.expect('IDENTIFIER').value);
        if (this.current().value === ',') this.advance();
      }
      this.expect('PUNCTUATION', ')');
    }

    // Parse optional constraints: where Eq(a), Show(a)
    let constraints: Constraint[] = [];
    if (this.current().value === 'where') {
      this.advance();
      constraints = this.parseConstraints();
    }

    this.skipNewlines();
    this.expect('INDENT');
    this.skipNewlines();

    // Parse methods
    const methods: MethodDecl[] = [];
    while (this.current().type !== 'DEDENT' && this.current().type !== 'EOF') {
      if (this.current().type === 'KEYWORD' && ['impl', 'typeclass', 'type', 'fn', 'let', 'import', 'public'].includes(this.current().value)) {
        break;
      }

      const decorators = this.parseDecorators();
      if (decorators.length > 0 && this.current().type !== 'IDENTIFIER') {
        throw new Error('Decorators in typeclasses must be followed by a method declaration');
      }
      
      const methodName = this.expect('IDENTIFIER').value;
      this.expect('PUNCTUATION', '(');
      
      const params: Param[] = [];
      while (this.current().value !== ')') {
        const paramName = this.expect('IDENTIFIER').value;
        let paramType: Node | undefined;
        
        if (this.current().type === 'IDENTIFIER' || (this.current().type === 'KEYWORD' && this.current().value !== ')')) {
          paramType = this.parseType();
        }
        
        params.push({ type: 'Param', name: paramName, paramType });
        if (this.current().value === ',') this.advance();
      }
      this.expect('PUNCTUATION', ')');
      
      this.expect('OPERATOR', '->');
      const returnType = this.parseType();
      
      let body: Node | undefined;
      if (this.current().value === '=') {
        this.advance();
        body = this.parseExpr();
      }
      
      methods.push({
        type: 'MethodDecl',
        name: methodName,
        params,
        returnType,
        decorators,
        body,
      });
      
      this.skipNewlines();
    }

    if (this.current().type === 'DEDENT') {
      this.advance();
    }
    return { type: 'TypeclassDecl', name, typeParams, constraints, methods };
  }

  private parseInstanceDecl(): InstanceDecl {
    this.advance(); // consume 'impl'
    const typeclass = this.expect('IDENTIFIER').value;
    
    // Parse 'for' keyword
    this.expect('KEYWORD', 'for');
    
    // Parse for-types: Int, String, (Int, String), etc.
    const forTypes: Node[] = [];
    
    if (this.current().value === '(') {
      // Multiple types: (Int, String)
      this.advance();
      while (this.current().value !== ')') {
        forTypes.push(this.parseType());
        if (this.current().value === ',') this.advance();
      }
      this.expect('PUNCTUATION', ')');
    } else {
      // Single type: Int
      forTypes.push(this.parseType());
    }

    // Parse optional constraints: where Eq(a), Show(a)
    let constraints: Constraint[] = [];
    if (this.current().value === 'where') {
      this.advance();
      constraints = this.parseConstraints();
    }

    this.skipNewlines();
    this.expect('INDENT');
    this.skipNewlines();

    // Parse method implementations
    const methods: MethodImpl[] = [];
    while (this.current().type !== 'DEDENT' && this.current().type !== 'EOF') {
      if (!this.isInstanceMethodStart()) {
        break;
      }

      if (this.current().type === 'KEYWORD' && ['impl', 'typeclass', 'type', 'fn', 'let', 'import', 'public'].includes(this.current().value)) {
        break;
      }

      const decorators = this.parseDecorators();
      if (decorators.length > 0 && !this.isInstanceMethodStart()) {
        throw new Error('Decorators in impl blocks must be followed by a method declaration');
      }
      
      const methodName = this.expect('IDENTIFIER').value;
      this.expect('PUNCTUATION', '(');
      
      // Parse and capture parameters
      const params: string[] = [];
      while (this.current().value !== ')') {
        if (this.current().type === 'IDENTIFIER') {
          params.push(this.current().value);
          this.advance();
        } else {
          this.parsePattern(); // For more complex patterns
        }
        if (this.current().value === ',') this.advance();
      }
      this.expect('PUNCTUATION', ')');
      
      this.expect('OPERATOR', '=');
      
      let body: Node;
      this.skipNewlines();
      
      if (this.current().type === 'INDENT' || 
          (this.current().type === 'KEYWORD' && ['let', 'if', 'match'].includes(this.current().value))) {
        body = this.parseBlockBody();
      } else {
        body = this.parseExpr();
      }
      
      methods.push({
        type: 'MethodImpl',
        name: methodName,
        params,
        decorators,
        body,
      });
      
      this.skipNewlines();
    }

    if (this.current().type === 'DEDENT') {
      this.advance();
    }
    return { type: 'InstanceDecl', typeclass, forTypes, constraints, methods };
  }

  private isInstanceMethodStart(): boolean {
    if (this.current().type === 'DECORATOR') {
      return true;
    }
    if (this.current().type !== 'IDENTIFIER') {
      return false;
    }
    if (this.peek().value !== '(') {
      return false;
    }

    let i = this.pos + 1;
    let depth = 0;
    while (i < this.tokens.length) {
      const token = this.tokens[i];
      if (token.value === '(') {
        depth++;
      } else if (token.value === ')') {
        depth--;
        if (depth === 0) {
          const next = this.tokens[i + 1];
          return next?.type === 'OPERATOR' && next.value === '=';
        }
      }
      i++;
    }

    return false;
  }

  private parseConstraints(): Constraint[] {
    const constraints: Constraint[] = [];
    
    while (true) {
      const name = this.expect('IDENTIFIER').value;
      const args: string[] = [];
      
      if (this.current().value === '(') {
        this.advance();
        while (this.current().value !== ')') {
          args.push(this.expect('IDENTIFIER').value);
          if (this.current().value === ',') this.advance();
        }
        this.expect('PUNCTUATION', ')');
      }
      
      constraints.push({ type: 'Constraint', name, args });
      
      if (this.current().value === ',') {
        this.advance();
      } else {
        break;
      }
    }
    
    return constraints;
  }
}

export function parse(source: string, externalOperators?: Map<string, OperatorInfo>): Program {
  const parser = new Parser();
  if (externalOperators) parser.setCustomOperators(externalOperators);
  return parser.parse(source);
}

/** Extract all @Operator declarations from source without needing the full AST. */
export function extractOperators(source: string): Map<string, OperatorInfo> {
  const parser = new Parser();
  parser.parse(source);
  return parser.getCustomOperators();
}
