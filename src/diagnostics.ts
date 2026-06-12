import type { Node } from './ast.js';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface CompilerDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  filePath: string;
  line: number;
  column: number;
  hint?: string;
}

export function createDiagnostic(
  code: string,
  message: string,
  filePath: string,
  node?: Node,
  hint?: string,
  severity: DiagnosticSeverity = 'error',
): CompilerDiagnostic {
  return {
    code,
    severity,
    message,
    filePath,
    line: node?.line ?? 1,
    column: node?.column ?? 1,
    hint,
  };
}

export function formatDiagnostic(diag: CompilerDiagnostic): string {
  const head = `${diag.filePath}:${diag.line}:${diag.column}`;
  const body = `[${diag.code}] ${diag.message}`;
  if (!diag.hint) {
    return `${head} ${body}`;
  }
  return `${head} ${body}\n  hint: ${diag.hint}`;
}
