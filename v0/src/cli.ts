#!/usr/bin/env node

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { execSync } from 'node:child_process'
import { compileSourceToC, compileSourceToJS, formatDiagnostic } from './index.js'

function makeResolver(filePath: string): (importedPath: string) => string | undefined {
  return (importedPath) => {
    try {
      return readFileSync(importedPath, 'utf8')
    } catch {
      return undefined
    }
  }
}

function handleDiagnostics(diagnostics: ReturnType<typeof formatDiagnostic>[]): void {
  for (const diagnostic of diagnostics) {
    console.error(diagnostic)
  }
  process.exit(1)
}

function runCheck(source: string, filePath: string): void {
  const result = compileSourceToC(source, filePath, makeResolver(filePath))
  if (result.diagnostics.length > 0) {
    handleDiagnostics(result.diagnostics.map(formatDiagnostic))
  }
  console.log(`OK: ${filePath}`)
}

function runCompileC(source: string, filePath: string, outPath?: string): void {
  const result = compileSourceToC(source, filePath, makeResolver(filePath))
  if (result.diagnostics.length > 0) {
    handleDiagnostics(result.diagnostics.map(formatDiagnostic))
  }
  const outputFile = outPath ?? join(dirname(filePath), `${basename(filePath, '.arix')}.c`)
  writeFileSync(outputFile, result.cSource, 'utf8')
  console.log(outputFile)
}

function runCompileJS(source: string, filePath: string, outPath?: string): void {
  const result = compileSourceToJS(source, filePath, makeResolver(filePath))
  if (result.diagnostics.length > 0) {
    handleDiagnostics(result.diagnostics.map(formatDiagnostic))
  }
  const outputFile = outPath ?? join(dirname(filePath), `${basename(filePath, '.arix')}.mjs`)
  writeFileSync(outputFile, result.jsSource, 'utf8')
  console.log(outputFile)
}

function runRun(source: string, filePath: string): void {
  const result = compileSourceToJS(source, filePath, makeResolver(filePath))
  if (result.diagnostics.length > 0) {
    handleDiagnostics(result.diagnostics.map(formatDiagnostic))
  }
  const tmpFile = join(dirname(filePath), `.__arix_run_${basename(filePath, '.arix')}.mjs`)
  writeFileSync(tmpFile, result.jsSource, 'utf8')
  try {
    execSync(`node "${tmpFile}"`, { stdio: 'inherit' })
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}

function main(): void {
  const [command, filePath, outPath] = process.argv.slice(2)

  if (!command || !filePath) {
    console.log('Usage: v0 <check|compile|compile-js|run> <file.arix> [out]')
    process.exit(command ? 1 : 0)
  }

  const source = readFileSync(filePath, 'utf8')

  if (command === 'check') { runCheck(source, filePath); return }
  if (command === 'compile') { runCompileC(source, filePath, outPath); return }
  if (command === 'compile-js') { runCompileJS(source, filePath, outPath); return }
  if (command === 'run') { runRun(source, filePath); return }

  console.error(`Unknown command: ${command}`)
  process.exit(1)
}

main()
