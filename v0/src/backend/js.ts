import {
  ArrayLiteral,
  BlockExpr,
  ConstructorExpr,
  EnumDecl,
  Expr,
  FunctionDecl,
  LetDecl,
  MatchArm,
  MatchExpr,
  Pattern,
  TypeAnnotation,
} from '../ast.js'
import { IrProgram } from '../ir.js'

interface EnumInfo {
  tagByVariant: Map<string, string>
}

interface ImplementationMethodInfo {
  typeclassName: string
  methodName: string
  typeParams: string[]
  functionName: string
  value: Expr
}

interface JsBackendContext {
  enumInfos: Map<string, EnumInfo>
  implMethods: ImplementationMethodInfo[]
  matchCounter: number
}

function collectEnumInfo(program: IrProgram): Map<string, EnumInfo> {
  const infos = new Map<string, EnumInfo>()

  for (const item of program.body) {
    if (item.type !== 'EnumDecl') {
      continue
    }

    const info: EnumInfo = {
      tagByVariant: new Map<string, string>(),
    }

    for (const variant of item.variants) {
      info.tagByVariant.set(variant.name, `${item.name}_${variant.name}`)
    }

    infos.set(item.name, info)
  }

  return infos
}

function collectImplementationMethodInfo(program: IrProgram): ImplementationMethodInfo[] {
  const infos: ImplementationMethodInfo[] = []

  for (const item of program.body) {
    if (item.type !== 'ImplementationDecl') {
      continue
    }

    const implementation = item
    const suffix = implementation.typeParams.join('_') || 'Any'

    for (const method of implementation.methods) {
      infos.push({
        typeclassName: implementation.typeclassName,
        methodName: method.name,
        typeParams: implementation.typeParams,
        functionName: `impl_${implementation.typeclassName}_${method.name}_${suffix}`,
        value: method.value,
      })
    }
  }

  return infos
}

function getConstructorTag(constructorName: string, enumInfos: Map<string, EnumInfo>): string | undefined {
  for (const info of enumInfos.values()) {
    const tag = info.tagByVariant.get(constructorName)
    if (tag) {
      return tag
    }
  }
  return undefined
}

function isTypeVariable(name: string): boolean {
  return /^[A-Z]$/.test(name)
}

function typeAnnotationKey(typeAnnotation: TypeAnnotation): string {
  if (typeAnnotation.type === 'TypeReference') {
    if (typeAnnotation.typeArgs.length === 0) {
      return typeAnnotation.name
    }
    return `${typeAnnotation.name}<${typeAnnotation.typeArgs.map(typeAnnotationKey).join(',')}>`
  }

  return `(${typeAnnotation.params.map(typeAnnotationKey).join(',')})=>${typeAnnotationKey(typeAnnotation.returnType)}`
}

function resolveImplementationMethod(
  methodName: string,
  genericArgs: TypeAnnotation[],
  implMethods: ImplementationMethodInfo[],
): string | undefined {
  const genericKeys = genericArgs.map(typeAnnotationKey)
  const candidates = implMethods.filter(
    candidate => candidate.methodName === methodName && candidate.typeParams.length === genericKeys.length,
  )

  let selected: { functionName: string; score: number } | undefined

  for (const candidate of candidates) {
    let score = 0
    let compatible = true

    for (let index = 0; index < candidate.typeParams.length; index += 1) {
      const expected = candidate.typeParams[index]
      const actual = genericKeys[index]

      if (isTypeVariable(expected)) {
        continue
      }

      if (expected !== actual) {
        compatible = false
        break
      }

      score += 1
    }

    if (!compatible) {
      continue
    }

    if (!selected || score > selected.score) {
      selected = { functionName: candidate.functionName, score }
    }
  }

  return selected?.functionName
}

function emitJsExpr(expr: Expr, context: JsBackendContext): string {
  switch (expr.type) {
    case 'NumberLiteral':
      return String(expr.value)
    case 'BooleanLiteral':
      return expr.value ? 'true' : 'false'
    case 'StringLiteral':
      return JSON.stringify(expr.value)
    case 'CharLiteral':
      return String(expr.value.codePointAt(0))
    case 'IdentifierExpr':
      return expr.name
    case 'ConstructorExpr':
      return emitJsConstructorExpr(expr, context)
    case 'CallExpr': {
      const args = expr.args.map(arg => emitJsExpr(arg, context)).join(', ')
      if (expr.callee.type === 'IdentifierExpr' && expr.genericArgs && expr.genericArgs.length > 0) {
        const target = resolveImplementationMethod(expr.callee.name, expr.genericArgs, context.implMethods)
        if (target) {
          return `${target}(${args})`
        }
      }
      return `${emitJsExpr(expr.callee, context)}(${args})`
    }
    case 'MemberExpr':
      return `${emitJsExpr(expr.object, context)}.${expr.property}`
    case 'BlockExpr': {
      const lines = emitJsBlockLines(expr, context)
      return `(() => {\n${lines.join('\n')}\n  })()`
    }
    case 'ReturnExpr':
      return expr.value ? emitJsExpr(expr.value, context) : 'undefined'
    case 'MatchExpr':
      return emitJsMatchExpr(expr, context)
    case 'ArrayLiteral':
      return emitJsArrayLiteral(expr, context)
    default:
      return 'undefined'
  }
}

function emitJsArrayLiteral(arrayLiteral: ArrayLiteral, context: JsBackendContext): string {
  const items = arrayLiteral.elements.map(element => emitJsExpr(element, context))
  return `[${items.join(', ')}]`
}

function emitJsConstructorExpr(expr: ConstructorExpr, context: JsBackendContext): string {
  const tag = getConstructorTag(expr.name, context.enumInfos)
  if (!tag) {
    return 'undefined'
  }
  const args = expr.args.map(arg => emitJsExpr(arg, context))
  return `${tag}(${args.join(', ')})`
}

function emitJsPatternCheck(pattern: Pattern, subject: string): string {
  switch (pattern.type) {
    case 'WildcardPattern':
      return 'true'
    case 'IdentifierPattern':
      return 'true'
    case 'LiteralPattern': {
      const literal = pattern.literal
      if (literal.type === 'NumberLiteral') {
        return `${subject} === ${literal.value}`
      }
      if (literal.type === 'BooleanLiteral') {
        return `${subject} === ${literal.value}`
      }
      if (literal.type === 'CharLiteral') {
        return `${subject} === ${literal.value.codePointAt(0)}`
      }
      return `${subject} === ${JSON.stringify(literal.value)}`
    }
    case 'ConstructorPattern': {
      const fieldChecks = pattern.args.map((child, index) =>
        emitJsPatternCheck(child, `${subject}.fields[${index}]`),
      )
      const allChecks = [`${subject} != null && ${subject}.__tag === "${pattern.name}"`, ...fieldChecks.filter(c => c !== 'true')]
      return allChecks.join(' && ')
    }
    default:
      return 'false'
  }
}

function emitJsPatternBindings(pattern: Pattern, subject: string): string[] {
  switch (pattern.type) {
    case 'IdentifierPattern':
      return [`const ${pattern.name} = ${subject};`]
    case 'ConstructorPattern':
      return pattern.args.flatMap((child, index) =>
        emitJsPatternBindings(child, `${subject}.fields[${index}]`),
      )
    default:
      return []
  }
}

function emitJsMatchArm(arm: MatchArm, subject: string, context: JsBackendContext): string {
  const check = emitJsPatternCheck(arm.pattern, subject)
  const bindings = emitJsPatternBindings(arm.pattern, subject)

  let fullCondition = check
  if (arm.guard) {
    fullCondition = `${check} && ${emitJsExpr(arm.guard, context)}`
  }

  const bodyLines = [...bindings, `return ${emitJsExpr(arm.body, context)};`]
  const indented = bodyLines.map(l => `    ${l}`).join('\n')
  return `if (${fullCondition}) {\n${indented}\n  }`
}

function emitJsMatchExpr(matchExpr: MatchExpr, context: JsBackendContext): string {
  context.matchCounter += 1
  const id = context.matchCounter
  const subject = `__m${id}`

  const arms = matchExpr.arms
    .map((arm, index) => (index === 0 ? '' : 'else ') + emitJsMatchArm(arm, subject, context))
    .join(' ')

  const inner = `const ${subject} = ${emitJsExpr(matchExpr.value, context)};\n  ${arms}\n  return undefined;`
  return `(() => {\n  ${inner}\n})()`
}

function emitJsBlock(block: BlockExpr, context: JsBackendContext): string {
  return emitJsBlockLines(block, context).join('\n')
}

function emitJsBlockLines(block: BlockExpr, context: JsBackendContext): string[] {
  const lines: string[] = []
  for (const item of block.body) {
    if (item.type === 'LetDecl') {
      lines.push(`  const ${item.name} = ${emitJsExpr(item.value, context)};`)
      continue
    }
    if (item.type === 'ReturnExpr') {
      // Desugar wraps lambda bodies in ReturnExpr { value: BlockExpr }.
      // Flatten the inner block directly instead of wrapping in `return (...)()`.
      if (item.value?.type === 'BlockExpr') {
        lines.push(...emitJsBlockLines(item.value, context))
      } else {
        lines.push(`  return ${item.value ? emitJsExpr(item.value, context) : 'undefined'};`)
      }
      continue
    }
    lines.push(`  ${emitJsExpr(item.expr, context)};`)
  }
  if (lines.length === 0) {
    lines.push('  return undefined;')
  }
  return lines
}

function emitJsFunction(functionDecl: FunctionDecl, context: JsBackendContext): string {
  const params = functionDecl.params.map(param => param.name).join(', ')
  return `function ${functionDecl.name}(${params}) {\n${emitJsBlock(functionDecl.body, context)}\n}`
}

function emitJsLetDecl(letDecl: LetDecl, context: JsBackendContext): string {
  if (letDecl.value.type === 'LambdaExpr') {
    return ''
  }
  return `const ${letDecl.name} = ${emitJsExpr(letDecl.value, context)};`
}

function emitJsConstructorFunctions(enumDecl: EnumDecl, enumInfo: EnumInfo): string {
  return enumDecl.variants
    .map(variant => {
      const tag = enumInfo.tagByVariant.get(variant.name) ?? variant.name
      const params = variant.fields.map((_, index) => `field${index}`).join(', ')
      const fields = variant.fields.map((_, index) => `field${index}`).join(', ')
      return `function ${tag}(${params}) { return { __tag: "${variant.name}", fields: [${fields}] }; }`
    })
    .join('\n')
}

function emitJsImplementationFunctions(context: JsBackendContext): string {
  const functions: string[] = []

  for (const methodInfo of context.implMethods) {
    if (methodInfo.value.type === 'LambdaExpr') {
      const params = methodInfo.value.params.map(param => param.name).join(', ')
      functions.push(
        `function ${methodInfo.functionName}(${params}) {\n  return ${emitJsExpr(methodInfo.value.body, context)};\n}`,
      )
      continue
    }

    functions.push(`const ${methodInfo.functionName} = ${emitJsExpr(methodInfo.value, context)};`)
  }

  return functions.join('\n\n')
}

function emitJsBuiltins(): string {
  return `// --- Arix builtins ---
function print(x) {
  if (x != null && typeof x === 'object' && '__tag' in x) {
    process.stdout.write(x.__tag + "\\n");
  } else {
    process.stdout.write(String(x) + "\\n");
  }
  return undefined;
}
function printLine(x) { return print(x); }
function intToString(x) { return String(x); }
function concat(a, b) { return String(a) + String(b); }
function length(xs) { return Array.isArray(xs) ? xs.length : 0; }
function get(xs, index) {
  if (!Array.isArray(xs)) return undefined;
  if (!Number.isInteger(index)) return undefined;
  if (index < 0 || index >= xs.length) return undefined;
  return xs[index];
}
function add(a, b) { return a + b; }
function sub(a, b) { return a - b; }
function mul(a, b) { return a * b; }
function div(a, b) { return Math.trunc(a / b); }
function mod(a, b) { return a % b; }
function eq(a, b) { return a === b; }
function lt(a, b) { return a < b; }
function gt(a, b) { return a > b; }
function lte(a, b) { return a <= b; }
function gte(a, b) { return a >= b; }
function not(x) { return !x; }
function and(a, b) { return a && b; }
function or(a, b) { return a || b; }
// --- end builtins ---
`
}

export function emitJS(program: IrProgram): string {
  const context: JsBackendContext = {
    enumInfos: collectEnumInfo(program),
    implMethods: collectImplementationMethodInfo(program),
    matchCounter: 0,
  }

  const enums = program.body.filter(item => item.type === 'EnumDecl') as EnumDecl[]
  const functions = program.body.filter(item => item.type === 'FunctionDecl') as FunctionDecl[]
  const lets = program.body.filter(item => item.type === 'LetDecl') as LetDecl[]

  const enumDecls = enums
    .map(enumDecl => {
      const enumInfo = context.enumInfos.get(enumDecl.name)
      if (!enumInfo) {
        return ''
      }
      return emitJsConstructorFunctions(enumDecl, enumInfo)
    })
    .filter(Boolean)
    .join('\n\n')

  const implementationFns = emitJsImplementationFunctions(context)
  const letDecls = lets.map(letDecl => emitJsLetDecl(letDecl, context)).filter(Boolean).join('\n')
  const body = functions.map(functionDecl => emitJsFunction(functionDecl, context)).join('\n\n')

  const hasMain = functions.some(fn => fn.name === 'main')
  const entryPoint = hasMain ? '\nmain();\n' : ''

  return `"use strict";\n\n${emitJsBuiltins()}\n${enumDecls}\n\n${implementationFns}\n\n${letDecls}\n\n${body}${entryPoint}`
}
