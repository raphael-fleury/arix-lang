export type NodeType =
  | 'Program'
  | 'NumberLiteral'
  | 'StringLiteral'
  | 'StringInterpolation'
  | 'BooleanLiteral'
  | 'NoneLiteral'
  | 'Identifier'
  | 'BinaryExpr'
  | 'UnaryExpr'
  | 'CallExpr'
  | 'IndexExpr'
  | 'MemberExpr'
  | 'FunctionExpr'
  | 'FunctionDecl'
  | 'LetDecl'
  | 'IfExpr'
  | 'MatchExpr'
  | 'MatchArm'
  | 'RecordLiteral'
  | 'ListLiteral'
  | 'ListComprehension'
  | 'TupleLiteral'
  | 'PipeExpr'
  | 'BlockExpr'
  | 'ReturnExpr'
  | 'AwaitExpr'
  | 'ImportStmt'
  | 'TypeDecl'
  | 'ForExpr'
  | 'WhileExpr'
  | 'BreakExpr'
  | 'ContinueExpr'
  | 'Pattern'
  | 'Guard'
  | 'Param'
  | 'TypeVariant';

export interface Node {
  type: NodeType;
  line?: number;
  column?: number;
}

export interface Program extends Node {
  type: 'Program';
  body: Node[];
}

export interface NumberLiteral extends Node {
  type: 'NumberLiteral';
  value: number;
}

export interface StringLiteral extends Node {
  type: 'StringLiteral';
  value: string;
}

export interface StringInterpolation extends Node {
  type: 'StringInterpolation';
  parts: (StringPart | ExprPart)[];
}

export interface StringPart {
  type: 'StringPart';
  value: string;
}

export interface ExprPart {
  type: 'ExprPart';
  expr: Node;
}

export interface BooleanLiteral extends Node {
  type: 'BooleanLiteral';
  value: boolean;
}

export interface NoneLiteral extends Node {
  type: 'NoneLiteral';
}

export interface Identifier extends Node {
  type: 'Identifier';
  name: string;
}

export interface BinaryExpr extends Node {
  type: 'BinaryExpr';
  operator: string;
  left: Node;
  right: Node;
}

export interface UnaryExpr extends Node {
  type: 'UnaryExpr';
  operator: string;
  operand: Node;
}

export interface CallExpr extends Node {
  type: 'CallExpr';
  callee: Node;
  args: Node[];
  genericArgs?: Node[];
}

export interface IndexExpr extends Node {
  type: 'IndexExpr';
  object: Node;
  index: Node;
}

export interface MemberExpr extends Node {
  type: 'MemberExpr';
  object: Node;
  property: Node;
  computed: boolean;
}

export interface FunctionExpr extends Node {
  type: 'FunctionExpr';
  params: Param[];
  body: Node;
  returnType?: Node;
}

export interface FunctionDecl extends Node {
  type: 'FunctionDecl';
  name: string;
  params: Param[];
  body: Node;
  returnType?: Node;
  visibility: 'public' | 'internal' | 'private';
  isAsync: boolean;
}

export interface Param {
  type: 'Param';
  name: string;
  pattern?: Pattern;
  defaultValue?: Node;
  paramType?: Node;
}

export interface LetDecl extends Node {
  type: 'LetDecl';
  pattern: Pattern;
  value: Node;
  isMutable: boolean;
}

export interface IfExpr extends Node {
  type: 'IfExpr';
  condition: Node;
  thenBranch: Node;
  elseBranch: Node;
}

export interface MatchExpr extends Node {
  type: 'MatchExpr';
  value: Node;
  arms: MatchArm[];
}

export interface MatchArm extends Node {
  type: 'MatchArm';
  pattern: Pattern;
  guard?: Guard;
  body: Node;
}

export interface Guard extends Node {
  type: 'Guard';
  condition: Node;
}

export interface RecordLiteral extends Node {
  type: 'RecordLiteral';
  fields: { key: string; value: Node }[];
}

export interface ListLiteral extends Node {
  type: 'ListLiteral';
  elements: Node[];
}

export interface ListComprehension extends Node {
  type: 'ListComprehension';
  element: Node;
  pattern: Pattern;
  iterable: Node;
  condition?: Node;
}

export interface TupleLiteral extends Node {
  type: 'TupleLiteral';
  elements: Node[];
}

export interface PipeExpr extends Node {
  type: 'PipeExpr';
  left: Node;
  right: Node;
}

export interface BlockExpr extends Node {
  type: 'BlockExpr';
  body: Node[];
}

export interface ReturnExpr extends Node {
  type: 'ReturnExpr';
  value?: Node;
}

export interface AwaitExpr extends Node {
  type: 'AwaitExpr';
  expression: Node;
}

export interface ForExpr extends Node {
  type: 'ForExpr';
  pattern: Pattern;
  iterable: Node;
  condition?: Node;
  body: Node;
}

export interface WhileExpr extends Node {
  type: 'WhileExpr';
  condition: Node;
  body: Node;
}

export interface BreakExpr extends Node {
  type: 'BreakExpr';
}

export interface ContinueExpr extends Node {
  type: 'ContinueExpr';
}

export interface ImportStmt extends Node {
  type: 'ImportStmt';
  module: string;
  isRelative: boolean;
  items?: string[];
  alias?: string;
  hiding?: string[];
}

export interface TypeDecl extends Node {
  type: 'TypeDecl';
  name: string;
  typeParams?: string[];
  variants: TypeVariant[];
  recordFields?: { name: string; fieldType: Node; default?: Node }[];
}

export interface TypeVariant {
  type: 'TypeVariant';
  name: string;
  fields: { name: string; fieldType: Node }[];
}

export type Pattern =
  | { type: 'WildcardPattern' }
  | { type: 'IdentifierPattern'; name: string; as?: string }
  | { type: 'LiteralPattern'; literal: NumberLiteral | StringLiteral | BooleanLiteral | NoneLiteral }
  | { type: 'RecordPattern'; fields: { key: string; pattern: Pattern; defaultValue?: Node }[]; rest?: string }
  | { type: 'TuplePattern'; elements: Pattern[] }
  | { type: 'ListPattern'; elements: Pattern[]; rest?: string }
  | { type: 'ConstructorPattern'; name: string; patterns: Pattern[] };
