export interface Node {
  type: string
  line?: number
  column?: number
}

export interface Program extends Node {
  type: 'Program'
  moduleName?: string
  imports: ImportDecl[]
  body: TopLevel[]
}

export type TopLevel = ModuleDecl | ImportDecl | EnumDecl | TypeclassDecl | ImplementationDecl | FunctionDecl | LetDecl | ExprStmt

export interface ModuleDecl extends Node {
  type: 'ModuleDecl'
  name: string
}

export interface ImportDecl extends Node {
  type: 'ImportDecl'
  path: string[]
}

export interface EnumDecl extends Node {
  type: 'EnumDecl'
  name: string
  typeParams: string[]
  variants: VariantDecl[]
}

export interface TypeclassDecl extends Node {
  type: 'TypeclassDecl'
  name: string
  typeParams: string[]
  constraints: Constraint[]
  methods: TypeclassMethodDecl[]
}

export interface Constraint extends Node {
  type: 'Constraint'
  name: string
  typeArgs: TypeAnnotation[]
}

export interface TypeclassMethodDecl extends Node {
  type: 'TypeclassMethodDecl'
  name: string
  signature: TypeAnnotation
  defaultValue?: Expr
}

export interface ImplementationDecl extends Node {
  type: 'ImplementationDecl'
  typeclassName: string
  typeParams: string[]
  methods: ImplementationMethodDecl[]
}

export interface ImplementationMethodDecl extends Node {
  type: 'ImplementationMethodDecl'
  name: string
  value: Expr
}

export interface VariantDecl extends Node {
  type: 'VariantDecl'
  name: string
  fields: TypeAnnotation[]
}

export interface FunctionDecl extends Node {
  type: 'FunctionDecl'
  name: string
  params: Parameter[]
  returnType?: TypeAnnotation
  body: BlockExpr
  isPublic: boolean
}

export interface Parameter {
  type: 'Parameter'
  name: string
  paramType?: TypeAnnotation
}

export interface LetDecl extends Node {
  type: 'LetDecl'
  name: string
  value: Expr
  declaredType?: TypeAnnotation
}

export interface ExprStmt extends Node {
  type: 'ExprStmt'
  expr: Expr
}

export type Expr =
  | IdentifierExpr
  | NumberLiteral
  | StringLiteral
  | CharLiteral
  | BooleanLiteral
  | CallExpr
  | MemberExpr
  | BlockExpr
  | MatchExpr
  | ReturnExpr
  | ConstructorExpr
  | LambdaExpr
  | ArrayLiteral

export interface IdentifierExpr extends Node {
  type: 'IdentifierExpr'
  name: string
}

export interface NumberLiteral extends Node {
  type: 'NumberLiteral'
  value: number
  isFloat?: boolean
}

export interface StringLiteral extends Node {
  type: 'StringLiteral'
  value: string
}

export interface CharLiteral extends Node {
  type: 'CharLiteral'
  value: string
}

export interface BooleanLiteral extends Node {
  type: 'BooleanLiteral'
  value: boolean
}

export interface CallExpr extends Node {
  type: 'CallExpr'
  callee: Expr
  args: Expr[]
  genericArgs?: TypeAnnotation[]
}

export interface MemberExpr extends Node {
  type: 'MemberExpr'
  object: Expr
  property: string
}

export interface BlockExpr extends Node {
  type: 'BlockExpr'
  body: (LetDecl | ExprStmt | ReturnExpr)[]
}

export interface MatchExpr extends Node {
  type: 'MatchExpr'
  value: Expr
  arms: MatchArm[]
}

export interface MatchArm extends Node {
  type: 'MatchArm'
  pattern: Pattern
  guard?: Expr
  body: Expr
}

export interface ReturnExpr extends Node {
  type: 'ReturnExpr'
  value?: Expr
}

export interface ConstructorExpr extends Node {
  type: 'ConstructorExpr'
  name: string
  args: Expr[]
}

export interface LambdaExpr extends Node {
  type: 'LambdaExpr'
  params: Parameter[]
  body: Expr
  returnType?: TypeAnnotation
}

export interface ArrayLiteral extends Node {
  type: 'ArrayLiteral'
  elements: Expr[]
}

export type Pattern =
  | WildcardPattern
  | IdentifierPattern
  | LiteralPattern
  | ConstructorPattern

export interface WildcardPattern extends Node {
  type: 'WildcardPattern'
}

export interface IdentifierPattern extends Node {
  type: 'IdentifierPattern'
  name: string
}

export interface LiteralPattern extends Node {
  type: 'LiteralPattern'
  literal: NumberLiteral | StringLiteral | CharLiteral | BooleanLiteral
}

export interface ConstructorPattern extends Node {
  type: 'ConstructorPattern'
  name: string
  args: Pattern[]
}

export interface TypeReference extends Node {
  type: 'TypeReference'
  name: string
  typeArgs: TypeAnnotation[]
}

export interface FunctionTypeReference extends Node {
  type: 'FunctionTypeReference'
  params: TypeAnnotation[]
  returnType: TypeAnnotation
}

export type TypeAnnotation = TypeReference | FunctionTypeReference