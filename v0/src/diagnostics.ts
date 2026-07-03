export type DiagnosticSeverity = 'error' | 'warning'

export interface Diagnostic {
  code: string
  message: string
  severity: DiagnosticSeverity
  filePath?: string
  line?: number
  column?: number
  hint?: string
}

export function createDiagnostic(
  code: string,
  message: string,
  filePath?: string,
  line?: number,
  column?: number,
  hint?: string,
  severity: DiagnosticSeverity = 'error',
): Diagnostic {
  return { code, message, severity, filePath, line, column, hint }
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const location = diagnostic.filePath && diagnostic.line != null && diagnostic.column != null
    ? `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column} `
    : ''

  const hint = diagnostic.hint ? `\n  hint: ${diagnostic.hint}` : ''
  return `${location}[${diagnostic.code}] ${diagnostic.message}${hint}`
}