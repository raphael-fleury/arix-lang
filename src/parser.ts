import { tokenize, Token, TokenType } from './lexer.js';
import type {
  Node,
  Program,
  NumberLiteral,
  StringLiteral,
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
  Param,
  Pattern,
  Guard,
} from './ast.js';

class Parser {
  private tokens: Token[] = [];
  private pos = 0;

  parse(source: string): Program {
    this.tokens = tokenize(source);
    this.pos = 0;
    const body = this.parseBody();
    return { type: 'Program', body };
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
    const token = this.current();

    if (token.type === 'KEYWORD') {
      switch (token.value) {
        case 'fn':
          return this.parseFunctionDecl();
        case 'async':
          return this.parseAsyncFunctionDecl();
        case 'let':
          return this.parseLetDecl();
        case 'type':
          return this.parseTypeDecl();
        case 'import':
          return this.parseImportStmt();
        case 'public':
        case 'internal':
          return this.parseVisibilityStatement();
      }
    }

    return this.parseExpr();
  }

  private parseAsyncFunctionDecl(): FunctionDecl {
    this.advance(); // consume 'async'
    const fn = this.parseFunctionDecl();
    fn.isAsync = true;
    return fn;
  }

  private parseVisibilityStatement(): Node {
    const visibility = this.advance().value as 'public' | 'internal';
    if (this.current().value === 'fn') {
      const fn = this.parseFunctionDecl();
      (fn as FunctionDecl).visibility = visibility;
      return fn;
    }
    if (this.current().value === 'async') {
      const fn = this.parseAsyncFunctionDecl();
      fn.visibility = visibility;
      return fn;
    }
    throw new Error(`Expected 'fn' after visibility modifier`);
  }

  private parseFunctionDecl(): FunctionDecl {
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

    this.skipNewlines();
    this.expect('OPERATOR', '=');
    this.skipNewlines();
    
    let body: Node;
    
    // Check if body is multi-line (starts with INDENT) or a keyword that needs block context
    if (this.current().type === 'INDENT' || 
        (this.current().type === 'KEYWORD' && ['let', 'if', 'match', 'try'].includes(this.current().value))) {
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
      visibility: 'private',
      isAsync,
    };
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
      
      // Let declarations inside blocks are allowed
      if (this.current().value === 'let') {
        body.push(this.parseLetDecl());
      } else if (this.current().type !== 'EOF' && this.current().type !== 'DEDENT') {
        body.push(this.parseExpr());
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
      } else {
        while (this.current().type !== 'NEWLINE' && this.current().type !== 'EOF') {
          const variantName = this.expect('IDENTIFIER').value;
          const fields: { name: string; fieldType: Node }[] = [];

          if (this.current().value === '(') {
            this.advance();
            while (this.current().value !== ')') {
              const fieldName = this.current().type === 'IDENTIFIER' ? this.expect('IDENTIFIER').value : '';
              const fieldType = this.parseType();
              fields.push({ name: fieldName, fieldType });
              if (this.current().value === ',') this.advance();
            }
            this.expect('PUNCTUATION', ')');
          }

          variants.push({ type: 'TypeVariant', name: variantName, fields });
          
          if (this.current().value === '|') this.advance();
          else break;
        }
      }

      return { type: 'TypeDecl', name, typeParams, variants, recordFields: isRecord ? recordFields : undefined };
    }

    return { type: 'TypeDecl', name, typeParams, variants };
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
    if (this.current().value === '!' || this.current().value === '-') {
      const operator = this.advance().value;
      const operand = this.parseUnary();
      return { type: 'UnaryExpr', operator, operand } as UnaryExpr;
    }
    if (this.current().value === 'await') {
      this.advance();
      const expression = this.parseUnary();
      return { type: 'AwaitExpr', expression } as AwaitExpr;
    }
    // Check for section operators: ++, -- (operators that can't be unary)
    if (this.current().type === 'OPERATOR' && (this.current().value === '++' || this.current().value === '--')) {
      return this.parseSectionOperator();
    }
    return this.parseBinary();
  }

  private parseBinary(): Node {
    return this.parseBinaryWithPrecedence(0);
  }

  private parseBinaryWithPrecedence(minPrecedence: number): Node {
    let left = this.parseCall();
    this.skipNewlines();

    const precedences: Record<string, number> = {
      '|>': 0,
      '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4,
      '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '++': 7,
    };

    while (true) {
      this.skipNewlines();
      const operator = this.current().value;
      const precedence = precedences[operator];
      if (precedence === undefined || precedence < minPrecedence) break;

      this.advance();
      this.skipNewlines();
      if (operator === '|>') {
        const right = this.parseCall();
        left = { type: 'PipeExpr', left, right } as PipeExpr;
      } else {
        const nextPrecedence = precedence + 1;
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
      } else if (this.current().value === '.') {
        this.advance();
        const propertyToken = this.expect('IDENTIFIER');
        const property = { type: 'Identifier' as const, name: propertyToken.value };
        expr = { type: 'MemberExpr', object: expr, property, computed: false } as MemberExpr;
      } else if (this.current().value === '[') {
        this.advance();
        const index = this.parseExpr();
        this.expect('PUNCTUATION', ']');
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

    if (token.type === 'KEYWORD') {
      if (token.value === 'true' || token.value === 'false') {
        this.advance();
        return { type: 'BooleanLiteral', value: token.value === 'true' } as BooleanLiteral;
      }
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

  private parseSectionOperator(): Node {
    const operator = this.advance().value;
    
    const savedPos = this.pos;
    const savedToken = this.current();
    
    if (savedToken.type === 'NUMBER' || savedToken.type === 'STRING' || 
        savedToken.type === 'IDENTIFIER' || savedToken.value === 'true' || 
        savedToken.value === 'false' || savedToken.value === 'None') {
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
    this.expect('KEYWORD', 'then');
    this.skipNewlines();
    const thenBranch = this.parseExpr();
    this.skipNewlines();
    this.expect('KEYWORD', 'else');
    this.skipNewlines();
    const elseBranch = this.parseExpr();

    return { type: 'IfExpr', condition, thenBranch, elseBranch };
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
      
      // Stop at closing punctuation (only at top level, not in multi-line)
      if (token.type === 'PUNCTUATION' && (token.value === ')' || token.value === '}' || token.value === ']')) {
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

  private parseListLiteral(): Node {
    this.advance(); // consume '['

    // Empty list
    if (this.current().value === ']') {
      this.advance();
      return { type: 'ListLiteral', elements: [] } as ListLiteral;
    }

    // Check for list comprehension or pattern with rest
    if (this.current().value === '|') {
      const elements: Node[] = [];
      this.advance();
      const rest = this.parseExpr();
      this.expect('PUNCTUATION', ']');
      return { 
        type: 'CallExpr', 
        callee: { type: 'MemberExpr', object: { type: 'Identifier', name: 'List' }, property: { type: 'Identifier', name: 'cons' }, computed: false },
        args: [rest]
      } as CallExpr;
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
        const head: Node = elements.length === 1 ? elements[0] : { type: 'ListLiteral', elements } as ListLiteral;
        return { 
          type: 'CallExpr', 
          callee: { type: 'MemberExpr', object: { type: 'Identifier', name: 'List' }, property: { type: 'Identifier', name: 'cons' }, computed: false },
          args: [head, rest]
        } as CallExpr;
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
    
    if (this.current().value === ')') {
      this.expect('PUNCTUATION', ')');
      return { type: 'TupleLiteral', elements: [] } as TupleLiteral;
    }

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
}

export function parse(source: string): Program {
  const parser = new Parser();
  return parser.parse(source);
}
