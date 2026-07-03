export * from './ast.js'
export * from './backend/c.js'
export * from './backend/js.js'
export * from './desugar.js'
export * from './diagnostics.js'
export * from './ir.js'
export * from './lexer.js'
export * from './parser.js'
export * from './typechecker.js'

import { join, dirname } from 'node:path'
import { desugar } from './desugar.js'
import { emitC } from './backend/c.js'
import { emitJS } from './backend/js.js'
import { parse } from './parser.js'
import { TypeChecker } from './typechecker.js'
import { IrProgram } from './ir.js'
import { Diagnostic, createDiagnostic } from './diagnostics.js'

export type FileResolver = (filePath: string) => string | undefined

function resolveModulePath(importPath: string[], fromFile: string): string {
  const relativePath = importPath.join('/') + '.arix'
  return join(dirname(fromFile), relativePath)
}

function collectModules(
  filePath: string,
  source: string,
  resolver: FileResolver,
  visited: Set<string>,
): IrProgram[] {
  if (visited.has(filePath)) {
    return []
  }
  visited.add(filePath)

  const ast = parse(source)
  const ir = desugar(ast)
  const results: IrProgram[] = [ir]

  for (const imp of ir.imports) {
    const importedPath = resolveModulePath(imp.path, filePath)
    if (visited.has(importedPath)) {
      continue
    }
    const importedSource = resolver(importedPath)
    if (importedSource === undefined) {
      continue
    }
    results.push(...collectModules(importedPath, importedSource, resolver, visited))
  }

  return results
}

function mergePrograms(programs: IrProgram[]): IrProgram {
  if (programs.length === 0) {
    return { imports: [], body: [] }
  }
  return {
    moduleName: programs[0].moduleName,
    imports: programs.flatMap(p => p.imports),
    body: programs.flatMap(p => p.body),
  }
}

function compileProgram(
  source: string,
  filePath: string,
  resolver: FileResolver,
): { program?: IrProgram; diagnostics: Diagnostic[] } {
  try {
    const programs = collectModules(filePath, source, resolver, new Set())
    const merged = mergePrograms(programs)
    const diagnostics = new TypeChecker().check(merged, filePath)
    return { program: merged, diagnostics }
  } catch (error) {
    if (error instanceof Error) {
      const line = (error as { line?: number }).line
      const column = (error as { column?: number }).column
      return {
        diagnostics: [createDiagnostic('ARX1000', error.message, filePath, line, column)],
      }
    }
    return {
      diagnostics: [createDiagnostic('ARX1000', 'Unexpected compiler failure.', filePath)],
    }
  }
}

export function compileSourceToC(
  source: string,
  filePath = 'input.arix',
  resolver?: FileResolver,
): { cSource: string; diagnostics: Diagnostic[] } {
  const effectiveResolver: FileResolver = resolver ?? (() => undefined)
  const { program, diagnostics } = compileProgram(source, filePath, effectiveResolver)
  return {
    cSource: diagnostics.length === 0 && program ? emitC(program) : '',
    diagnostics,
  }
}

export function compileSourceToJS(
  source: string,
  filePath = 'input.arix',
  resolver?: FileResolver,
): { jsSource: string; diagnostics: Diagnostic[] } {
  const effectiveResolver: FileResolver = resolver ?? (() => undefined)
  const { program, diagnostics } = compileProgram(source, filePath, effectiveResolver)
  return {
    jsSource: diagnostics.length === 0 && program ? emitJS(program) : '',
    diagnostics,
  }
}