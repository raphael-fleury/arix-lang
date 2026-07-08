import {
  BlockExpr,
  Constraint,
  EnumDecl,
  Expr,
  ExprStmt,
  ImportDecl,
  LetDecl,
  MatchArm,
  MatchExpr,
  ModuleDecl,
  Parameter,
  Pattern,
  Program,
  TopLevel,
  TypeAnnotation,
  TypeclassDecl,
  TypeclassMethodDecl,
  ImplementationDecl,
  ImplementationMethodDecl,
  VariantDecl,
} from './ast.js'
import { Token, tokenize } from './lexer.js'

class Parser {
  private readonly tokens: Token[]
  private index = 0

  constructor(source: string) {
    this.tokens = tokenize(source)
  }

  parseProgram(): Program {
    const imports: ImportDecl[] = []
    const body: TopLevel[] = []
    let moduleName: string | undefined

    while (!this.isAtEnd()) {
      if (this.matchKeyword('module')) {
        const moduleDecl = this.parseModuleDecl()
        moduleName = moduleDecl.name
        body.push(moduleDecl)
        this.consumeOptional(';')
        continue
      }

      if (this.matchKeyword('import')) {
        const importDecl = this.parseImportDecl()
        imports.push(importDecl)
        body.push(importDecl)
        this.consumeOptional(';')
        continue
      }

      if (this.matchKeyword('enum')) {
        body.push(this.parseEnumDecl())
        continue
      }

      if (this.matchKeyword('typeclass')) {
        body.push(this.parseTypeclassDecl())
        continue
      }

      if (this.matchKeyword('implementation')) {
        body.push(this.parseImplementationDecl())
        continue
      }

      if (this.matchKeyword('let')) {
        body.push(this.parseLetDecl())
        continue
      }

      body.push({ type: 'ExprStmt', expr: this.parseExpression() })
      this.consumeOptional(';')
    }

    return {
      type: 'Program',
      moduleName,
      imports,
      body,
    }
  }

  private parseModuleDecl(): ModuleDecl {
    const name = this.consumeIdentifier('Expected module name after module')
    return { type: 'ModuleDecl', name, line: this.previous().line, column: this.previous().column }
  }

  private parseImportDecl(): ImportDecl {
    const path: string[] = [this.consumeIdentifier('Expected import path after import')]
    while (this.consumeOptional('.')) {
      path.push(this.consumeIdentifier('Expected identifier after import path dot'))
    }
    return { type: 'ImportDecl', path, line: this.previous().line, column: this.previous().column }
  }

  private parseEnumDecl(): EnumDecl {
    const name = this.consumeIdentifier('Expected enum name')
    const typeParams = this.parseTypeParameterList()
    this.consume('{', 'Expected { after enum declaration')
    const variants: VariantDecl[] = []

    while (!this.check('}') && !this.isAtEnd()) {
      const variantName = this.consumeIdentifier('Expected variant name')
      const fields = this.match('(') ? this.parseTypeArgumentList(')') : []
      variants.push({ type: 'VariantDecl', name: variantName, fields })
      this.consumeOptional(',')
      this.consumeOptional(';')
    }

    this.consume('}', 'Expected } to close enum declaration')
    this.consumeOptional(';')
    return { type: 'EnumDecl', name, typeParams, variants }
  }

  private parseTypeclassDecl(): TypeclassDecl {
    const name = this.consumeIdentifier('Expected typeclass name')
    const typeParams = this.parseTypeParameterList()
    const constraints = this.matchKeyword('where') ? this.parseConstraints() : []
    this.consume('{', 'Expected { after typeclass declaration')
    const methods: TypeclassMethodDecl[] = []

    while (!this.check('}') && !this.isAtEnd()) {
      const methodName = this.consumeIdentifier('Expected typeclass method name')
      this.consume(':', 'Expected : after method name')
      const signature = this.parseTypeAnnotation()
      let defaultValue: Expr | undefined
      if (this.consumeOptional('=')) {
        defaultValue = this.parseExpression()
      }
      methods.push({ type: 'TypeclassMethodDecl', name: methodName, signature, defaultValue })
      this.consumeOptional(';')
    }

    this.consume('}', 'Expected } to close typeclass declaration')
    this.consumeOptional(';')
    return { type: 'TypeclassDecl', name, typeParams, constraints, methods }
  }

  private parseConstraints(): Constraint[] {
    const constraints: Constraint[] = []
    do {
      const name = this.consumeIdentifier('Expected constraint typeclass name')
      let typeArgs: TypeAnnotation[] = []
      if (this.match('<')) {
        typeArgs = this.parseTypeArgumentList('>')
      }
      constraints.push({ type: 'Constraint', name, typeArgs })
    } while (this.consumeOptional(','))
    return constraints
  }

  private parseImplementationDecl(): ImplementationDecl {
    const typeclassName = this.consumeIdentifier('Expected typeclass name after implementation')
    const typeParams = this.parseTypeParameterList()
    this.consume('{', 'Expected { after implementation declaration')
    const methods: ImplementationMethodDecl[] = []

    while (!this.check('}') && !this.isAtEnd()) {
      const methodName = this.consumeIdentifier('Expected implementation method name')
      this.consume('=', 'Expected = in implementation method')
      const value = this.parseExpression()
      methods.push({ type: 'ImplementationMethodDecl', name: methodName, value })
      this.consumeOptional(';')
    }

    this.consume('}', 'Expected } to close implementation declaration')
    this.consumeOptional(';')
    return { type: 'ImplementationDecl', typeclassName, typeParams, methods }
  }

  private parseLetDecl(): LetDecl {
    const name = this.consumeIdentifier('Expected binding name')
    const declaredType = this.consumeOptional(':') ? this.parseTypeAnnotation() : undefined
    this.consume('=', 'Expected = in let declaration')
    const value = this.parseExpression()
    this.consumeOptional(';')
    return { type: 'LetDecl', name, declaredType, value }
  }

  private parseBlock(): BlockExpr {
    this.consume('{', 'Expected { to start block')
    const body: (LetDecl | ExprStmt)[] = []

    while (!this.check('}') && !this.isAtEnd()) {
      if (this.matchKeyword('let')) {
        body.push(this.parseLetDecl())
        continue
      }

      const expr = this.parseExpression()
      body.push({ type: 'ExprStmt', expr })
      this.consumeOptional(';')
    }

    this.consume('}', 'Expected } to close block')
    return { type: 'BlockExpr', body }
  }

  private parseExpression(): Expr {
    if (this.matchKeyword('match')) {
      return this.parseMatchExpr()
    }

    if (this.check('{')) {
      return this.parseBlock()
    }

    return this.parsePostfixExpression()
  }

  private parseMatchExpr(): MatchExpr {
    const value = this.parseExpression()
    this.consume('{', 'Expected { after match expression')
    const arms: MatchArm[] = []
    while (!this.check('}') && !this.isAtEnd()) {
      const pattern = this.parsePattern()
      const guard = this.matchKeyword('when') ? this.parseExpression() : undefined
      this.consume('=>', 'Expected => in match arm')
      const body = this.parseExpression()
      arms.push({ type: 'MatchArm', pattern, guard, body })
      this.consumeOptional(';')
      this.consumeOptional(',')
    }
    this.consume('}', 'Expected } to close match expression')
    return { type: 'MatchExpr', value, arms }
  }

  private parsePostfixExpression(): Expr {
    let expr = this.parsePrimaryExpression()

    while (true) {
      if (expr.type === 'IdentifierExpr' && this.match('<')) {
        const genericArgs = this.parseTypeArgumentList('>')
        this.consume('(', 'Expected ( after generic arguments')
        expr = this.parseCallLikeExpression(expr, genericArgs)
        continue
      }

      if (this.match('(')) {
        expr = this.parseCallLikeExpression(expr)
        continue
      }

      if (this.match('.')) {
        const property = this.consumeIdentifier('Expected property name after .')
        expr = { type: 'MemberExpr', object: expr, property }
        continue
      }

      break
    }

    return expr
  }

  private parseCallLikeExpression(callee: Expr, genericArgs?: TypeAnnotation[]): Expr {
    const args: Expr[] = []
    if (!this.check(')')) {
      do {
        args.push(this.parseExpression())
      } while (this.consumeOptional(','))
    }
    this.consume(')', 'Expected ) after call arguments')

    if (callee.type === 'IdentifierExpr' && /^[A-Z]/.test(callee.name)) {
      return { type: 'ConstructorExpr', name: callee.name, args }
    }

    return { type: 'CallExpr', callee, args, genericArgs }
  }

  private parsePrimaryExpression(): Expr {
    if (this.match('number')) {
      const token = this.previous()
      return { type: 'NumberLiteral', value: Number(token.value), isFloat: token.value.includes('.') }
    }

    if (this.match('string')) {
      return { type: 'StringLiteral', value: this.previous().value }
    }

    if (this.match('char')) {
      return { type: 'CharLiteral', value: this.previous().value }
    }

    if (this.matchKeyword('True')) {
      return { type: 'BooleanLiteral', value: true }
    }

    if (this.matchKeyword('False')) {
      return { type: 'BooleanLiteral', value: false }
    }

    if (this.check('[')) {
      return this.parseArrayLiteral()
    }

    if (this.check('{')) {
      return this.parseBlock()
    }

    if (this.check('(')) {
      return this.parseParenExpressionOrLambda()
    }

    const name = this.consumeIdentifier('Expected expression')
    return { type: 'IdentifierExpr', name }
  }

  private parseParameterList(): Parameter[] {
    this.consume('(', 'Expected ( after function name')
    const params: Parameter[] = []
    if (!this.check(')')) {
      do {
        const name = this.consumeIdentifier('Expected parameter name')
        const paramType = this.consumeOptional(':') ? this.parseTypeAnnotation() : undefined
        params.push({ type: 'Parameter', name, paramType })
      } while (this.consumeOptional(','))
    }
    this.consume(')', 'Expected ) after parameter list')
    return params
  }

  private parseTypeAnnotation(): TypeAnnotation {
    if (this.check('(')) {
      return this.parseFunctionTypeReference()
    }

    const firstType = this.parseTypeReference()

    if (this.consumeOptional('=>')) {
      return {
        type: 'FunctionTypeReference',
        params: [firstType],
        returnType: this.parseTypeAnnotation(),
      }
    }

    if (this.consumeOptional(',')) {
      const params: TypeAnnotation[] = [firstType]
      do {
        params.push(this.check('(') ? this.parseFunctionTypeReference() : this.parseTypeReference())
      } while (this.consumeOptional(','))

      if (this.consumeOptional('=>')) {
        return {
          type: 'FunctionTypeReference',
          params,
          returnType: this.parseTypeAnnotation(),
        }
      }
    }

    return firstType
  }

  private parseTypeReference(): TypeAnnotation {
    const name = this.consumeIdentifier('Expected type name')
    const typeArgs = this.match('<') ? this.parseTypeArgumentList('>') : []
    return { type: 'TypeReference', name, typeArgs }
  }

  private parseFunctionTypeReference(): TypeAnnotation {
    this.consume('(', 'Expected ( in function type')
    const params: TypeAnnotation[] = []
    if (!this.check(')')) {
      do {
        params.push(this.parseTypeAnnotation())
      } while (this.consumeOptional(','))
    }
    this.consume(')', 'Expected ) in function type')
    this.consume('=>', 'Expected => in function type')
    const returnType = this.parseTypeAnnotation()
    return { type: 'FunctionTypeReference', params, returnType }
  }

  private parseTypeArgumentList(closeToken: string): TypeAnnotation[] {
    const args: TypeAnnotation[] = []
    if (!this.check(closeToken)) {
      do {
        args.push(this.parseTypeAnnotation())
      } while (this.consumeOptional(','))
    }
    this.consume(closeToken, `Expected ${closeToken}`)
    return args
  }

  private parseTypeParameterList(): string[] {
    const params: string[] = []
    if (!this.match('<')) {
      return params
    }
    if (!this.check('>')) {
      do {
        params.push(this.consumeIdentifier('Expected type parameter name'))
      } while (this.consumeOptional(','))
    }
    this.consume('>', 'Expected > after type parameters')
    return params
  }

  private parsePattern(): Pattern {
    if (this.matchKeyword('_')) {
      return { type: 'WildcardPattern' }
    }
    if (this.match('number')) {
      const token = this.previous()
      return {
        type: 'LiteralPattern',
        literal: { type: 'NumberLiteral', value: Number(token.value), isFloat: token.value.includes('.') },
      }
    }
    if (this.match('string')) {
      return { type: 'LiteralPattern', literal: { type: 'StringLiteral', value: this.previous().value } }
    }
    if (this.match('char')) {
      return { type: 'LiteralPattern', literal: { type: 'CharLiteral', value: this.previous().value } }
    }
    if (this.matchKeyword('True')) {
      return { type: 'LiteralPattern', literal: { type: 'BooleanLiteral', value: true } }
    }
    if (this.matchKeyword('False')) {
      return { type: 'LiteralPattern', literal: { type: 'BooleanLiteral', value: false } }
    }

    const name = this.consumeIdentifier('Expected pattern')
    if (this.match('(')) {
      const args: Pattern[] = []
      if (!this.check(')')) {
        do {
          args.push(this.parsePattern())
        } while (this.consumeOptional(','))
      }
      this.consume(')', 'Expected ) in constructor pattern')
      return { type: 'ConstructorPattern', name, args }
    }
    if (/^[A-Z]/.test(name)) {
      return { type: 'ConstructorPattern', name, args: [] }
    }
    return { type: 'IdentifierPattern', name }
  }

  private parseParenExpressionOrLambda(): Expr {
    this.consume('(', 'Expected (')
    const start = this.index
    const openParenIndex = start - 1
    const params: Parameter[] = []
    let isLambda = true

    if (!this.check(')')) {
      do {
        const token = this.peek()
        if (token.type !== 'identifier') {
          isLambda = false
          break
        }
        const name = this.consumeIdentifier('Expected parameter name')
        const paramType = this.consumeOptional(':') ? this.parseTypeAnnotation() : undefined
        params.push({ type: 'Parameter', name, paramType })
      } while (this.consumeOptional(','))
    }

    if (isLambda && this.check(')')) {
      this.consume(')', 'Expected ) in lambda expression')
      const returnType = this.consumeOptional(':') ? this.parseTypeAnnotation() : undefined
      if (this.match('=>')) {
        return { type: 'LambdaExpr', params, returnType, body: this.parseExpression() }
      }
    }

    this.index = openParenIndex
    this.consume('(', 'Expected (')
    const expr = this.parseExpression()
    this.consume(')', 'Expected ) after expression')
    return expr
  }

  private parseArrayLiteral(): Expr {
    this.consume('[', 'Expected [')
    const elements: Expr[] = []
    if (!this.check(']')) {
      do {
        elements.push(this.parseExpression())
      } while (this.consumeOptional(','))
    }
    this.consume(']', 'Expected ]')
    return { type: 'ArrayLiteral', elements }
  }

  private consumeIdentifier(message: string): string {
    const token = this.peek()
    if (token.type === 'identifier' || token.type === 'keyword' && /^[A-Z_]\w*$/.test(token.value)) {
      this.advance()
      return token.value
    }
    throw new Error(message)
  }

  private consumeOptional(value: string): boolean {
    if (this.check(value)) {
      this.advance()
      return true
    }
    return false
  }

  private consume(value: string, message: string): Token {
    if (!this.check(value)) {
      throw new Error(message)
    }
    return this.advance()
  }

  private consumeKeyword(value: string, message: string): Token {
    if (!this.matchKeyword(value)) {
      throw new Error(message)
    }
    return this.previous()
  }

  private match(typeOrValue: string): boolean {
    const token = this.peek()
    if (token.type === typeOrValue || token.value === typeOrValue) {
      this.advance()
      return true
    }
    return false
  }

  private matchKeyword(value: string): boolean {
    const token = this.peek()
    if (token.type === 'keyword' && token.value === value) {
      this.advance()
      return true
    }
    return false
  }

  private check(value: string): boolean {
    const token = this.peek()
    return token.type === value || token.value === value
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.index += 1
    }
    return this.previous()
  }

  private previous(): Token {
    return this.tokens[this.index - 1] ?? this.tokens[0]
  }

  private peek(): Token {
    return this.tokens.at(this.index) ?? this.tokens.at(-1) ?? { type: 'eof', value: '', line: 0, column: 0 }
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'eof'
  }

}

export function parse(source: string): Program {
  return new Parser(source).parseProgram()
}