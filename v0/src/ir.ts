import { EnumDecl, FunctionDecl, ImportDecl, ImplementationDecl, LetDecl, MatchExpr, Program, TopLevel, TypeclassDecl } from './ast.js'

export interface IrProgram {
  moduleName?: string
  imports: ImportDecl[]
  body: IrTopLevel[]
}

export type IrTopLevel = EnumDecl | TypeclassDecl | ImplementationDecl | FunctionDecl | LetDecl | MatchExpr | TopLevel

export function lowerToIr(program: Program): IrProgram {
  return {
    moduleName: program.moduleName,
    imports: program.imports,
    body: program.body,
  }
}