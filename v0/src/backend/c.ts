import {
  ArrayLiteral,
  BlockExpr,
  ConstructorExpr,
  EnumDecl,
  Expr,
  FunctionDecl,
  LetDecl,
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

interface BackendContext {
  enumInfos: Map<string, EnumInfo>
  implMethods: ImplementationMethodInfo[]
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
  const candidates = implMethods.filter(candidate => candidate.methodName === methodName && candidate.typeParams.length === genericKeys.length)

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

function emitRuntimePrelude(): string {
  return `typedef struct ArixValue {
  int tag;
  long intValue;
  double floatValue;
  const char *stringValue;
  size_t length;
  struct ArixValue **items;
  struct ArixValue *fields[8];
} ArixValue;

static ArixValue *arix_alloc(void) {
  ArixValue *value = (ArixValue *)calloc(1, sizeof(ArixValue));
  if (!value) {
    fprintf(stderr, "out of memory\\n");
    exit(1);
  }
  return value;
}

static ArixValue *arix_int(long value) {
  ArixValue *result = arix_alloc();
  result->tag = 1;
  result->intValue = value;
  return result;
}

static ArixValue *arix_bool(int value) {
  ArixValue *result = arix_alloc();
  result->tag = 2;
  result->intValue = value ? 1 : 0;
  return result;
}

static ArixValue *arix_string(const char *value) {
  ArixValue *result = arix_alloc();
  result->tag = 3;
  result->stringValue = value;
  return result;
}

static ArixValue *arix_unit(void) {
  ArixValue *result = arix_alloc();
  result->tag = 0;
  return result;
}

static ArixValue *arix_array(size_t length, ArixValue **items) {
  ArixValue *result = arix_alloc();
  result->tag = 4;
  result->length = length;
  result->items = items;
  return result;
}

static ArixValue *arrayLength(ArixValue *array) {
  if (!array || array->tag != 4) {
    return arix_int(0);
  }
  return arix_int((long)array->length);
}

static ArixValue *arrayGet(ArixValue *array, ArixValue *index) {
  if (!array || array->tag != 4 || !index || index->tag != 1) {
    return arix_unit();
  }

  long idx = index->intValue;
  if (idx < 0 || (size_t)idx >= array->length) {
    return arix_unit();
  }

  return array->items[idx];
}

`
}

function escapeCharForC(value: string): string {
  return value.replace("'", String.raw`\'`)
}

function emitExpr(expr: Expr, context: BackendContext): string {
  switch (expr.type) {
    case 'NumberLiteral':
      return `arix_int(${expr.value})`
    case 'BooleanLiteral':
      return `arix_bool(${expr.value ? 1 : 0})`
    case 'StringLiteral':
      return `arix_string(${JSON.stringify(expr.value)})`
    case 'CharLiteral':
      return `arix_int('${escapeCharForC(expr.value)}')`
    case 'IdentifierExpr':
      return expr.name
    case 'ConstructorExpr':
      return emitConstructorExpr(expr, context)
    case 'LambdaExpr':
      return 'arix_unit()'
    case 'CallExpr': {
      const args = expr.args.map(arg => emitExpr(arg, context)).join(', ')
      if (expr.callee.type === 'IdentifierExpr' && expr.genericArgs && expr.genericArgs.length > 0) {
        const target = resolveImplementationMethod(expr.callee.name, expr.genericArgs, context.implMethods)
        if (target) {
          return `${target}(${args})`
        }
      }
      return `${emitExpr(expr.callee, context)}(${args})`
    }
    case 'MemberExpr':
      return `${emitExpr(expr.object, context)}.${expr.property}`
    case 'BlockExpr':
      return emitBlock(expr, context)
    case 'ReturnExpr':
      return expr.value ? emitExpr(expr.value, context) : 'arix_unit()'
    case 'MatchExpr':
      return emitMatchExpr(expr, context)
    case 'ArrayLiteral':
      return emitArrayLiteral(expr, context)
    default:
      return 'arix_unit()'
  }
}

function emitArrayLiteral(arrayLiteral: ArrayLiteral, context: BackendContext): string {
  const items = arrayLiteral.elements.map(element => emitExpr(element, context)).join(', ')
  return `arix_array(${arrayLiteral.elements.length}, (ArixValue*[]){ ${items} })`
}

function emitConstructorExpr(expr: ConstructorExpr, context: BackendContext): string {
  const tag = getConstructorTag(expr.name, context.enumInfos)
  const args = expr.args.map(arg => emitExpr(arg, context)).join(', ')

  if (!tag) {
    return 'arix_unit()'
  }

  return `${tag}(${args})`
}

function emitPatternCheck(pattern: Pattern, subject: string, bindings: string[], context: BackendContext): string {
  switch (pattern.type) {
    case 'WildcardPattern':
      return '1'
    case 'IdentifierPattern':
      bindings.push(`  ArixValue *${pattern.name} = ${subject};`)
      return '1'
    case 'LiteralPattern': {
      const literal = pattern.literal
      if (literal.type === 'NumberLiteral') {
        return `${subject} != NULL && ${subject}->tag == 1 && ${subject}->intValue == ${literal.value}`
      }
      if (literal.type === 'BooleanLiteral') {
        return `${subject} != NULL && ${subject}->tag == 2 && ${subject}->intValue == ${literal.value ? 1 : 0}`
      }
      if (literal.type === 'CharLiteral') {
        return `${subject} != NULL && ${subject}->tag == 1 && ${subject}->intValue == '${escapeCharForC(literal.value)}'`
      }
      return `${subject} != NULL && ${subject}->tag == 3 && strcmp(${subject}->stringValue, ${JSON.stringify(literal.value)}) == 0`
    }
    case 'ConstructorPattern': {
      const tag = getConstructorTag(pattern.name, context.enumInfos)
      if (!tag) {
        return '0'
      }
      const checks = pattern.args.map((child, index) => emitPatternCheck(child, `${subject}->fields[${index}]`, bindings, context))
      const argsCheck = checks.length > 0 ? ` && (${checks.join(' && ')})` : ''
      return `${subject} != NULL && ${subject}->tag == ${tag}${argsCheck}`
    }
    default:
      return '0'
  }
}

function emitMatchExpr(matchExpr: MatchExpr, context: BackendContext): string {
  const suffix = `${matchExpr.arms.length}_${matchExpr.value.type}`
  const subject = `__match_value_${suffix}`
  const result = `__match_result_${suffix}`
  let lines: string[] = ['({', `  ArixValue *${subject} = ${emitExpr(matchExpr.value, context)};`, `  ArixValue *${result} = arix_unit();`]

  matchExpr.arms.forEach((arm, index) => {
    const bindings: string[] = []
    const condition = emitPatternCheck(arm.pattern, subject, bindings, context)
    const branchLines = [
      index === 0 ? `  if (${condition}) {` : `  else if (${condition}) {`,
      ...bindings,
      `    ${result} = ${emitExpr(arm.body, context)};`,
      '  }',
    ]
    lines = lines.concat(branchLines)
  })

  lines = lines.concat([`  ${result};`, '})'])
  return lines.join('\n')
}

function emitBlock(block: BlockExpr, context: BackendContext): string {
  const lines: string[] = []
  for (const item of block.body) {
    if (item.type === 'LetDecl') {
      lines.push(`  ArixValue *${item.name} = ${emitExpr(item.value, context)};`)
      continue
    }
    if (item.type === 'ReturnExpr') {
      lines.push(`  return ${item.value ? emitExpr(item.value, context) : 'arix_unit()'};`)
      continue
    }
    lines.push(`  ${emitExpr(item.expr, context)};`)
  }
  if (lines.length === 0) {
    lines.push('  return arix_unit();')
  }
  return lines.join('\n')
}

function emitFunction(functionDecl: FunctionDecl, context: BackendContext): string {
  const actualName = functionDecl.name === 'main' ? 'arix_main' : functionDecl.name
  const params = functionDecl.params.map(param => `ArixValue *${param.name}`).join(', ')
  return `static ArixValue *${actualName}(${params || 'void'}) {\n${emitBlock(functionDecl.body, context)}\n}`
}

function emitLetDecl(letDecl: LetDecl, context: BackendContext): string {
  if (letDecl.value.type === 'LambdaExpr') {
    return ''
  }
  return `static ArixValue *${letDecl.name} = ${emitExpr(letDecl.value, context)};`
}

function emitConstructorFunctions(enumDecl: EnumDecl, enumInfo: EnumInfo): string {
  return enumDecl.variants.map(variant => {
    const tag = enumInfo.tagByVariant.get(variant.name)
    const params = variant.fields.map((_, index) => `ArixValue *field${index}`).join(', ')
    const fieldAssignments = variant.fields.map((_, index) => `  value->fields[${index}] = field${index};`).join('\n')
    return [
      `static ArixValue *${tag}(${params || 'void'}) {`,
      '  ArixValue *value = arix_alloc();',
      `  value->tag = ${tag};`,
      fieldAssignments,
      '  return value;',
      '}',
    ].filter(Boolean).join('\n')
  }).join('\n\n')
}

function emitImplementationFunctions(program: IrProgram, context: BackendContext): string {
  const functions: string[] = []

  for (const methodInfo of context.implMethods) {
    if (methodInfo.value.type === 'LambdaExpr') {
      const params = methodInfo.value.params.map(param => `ArixValue *${param.name}`).join(', ')
      functions.push(`static ArixValue *${methodInfo.functionName}(${params || 'void'}) {\n  return ${emitExpr(methodInfo.value.body, context)};\n}`)
      continue
    }

    functions.push(`static ArixValue *${methodInfo.functionName}(void) {\n  return ${emitExpr(methodInfo.value, context)};\n}`)
  }

  return functions.join('\n\n')
}

export function emitC(program: IrProgram): string {
  const context: BackendContext = {
    enumInfos: collectEnumInfo(program),
    implMethods: collectImplementationMethodInfo(program),
  }

  const enums = program.body.filter(item => item.type === 'EnumDecl') as EnumDecl[]
  const functions = program.body.filter(item => item.type === 'FunctionDecl') as FunctionDecl[]
  const lets = program.body.filter(item => item.type === 'LetDecl') as LetDecl[]

  const enumDecls = enums.map(enumDecl => {
    const enumInfo = context.enumInfos.get(enumDecl.name)
    if (!enumInfo) {
      return ''
    }
    const tags = enumDecl.variants.map(variant => `  ${enumInfo.tagByVariant.get(variant.name)},`).join('\n')
    const constructors = emitConstructorFunctions(enumDecl, enumInfo)
    return `enum ${enumDecl.name}Tag {\n${tags}\n};\n\n${constructors}`
  }).filter(Boolean).join('\n\n')

  const implementationFns = emitImplementationFunctions(program, context)
  const letDecls = lets.map(letDecl => emitLetDecl(letDecl, context)).filter(Boolean).join('\n')
  const body = functions.map(functionDecl => emitFunction(functionDecl, context)).join('\n\n')
  const mainWrapper = functions.some(fn => fn.name === 'main')
    ? '\nint main(void) {\n  arix_main();\n  return 0;\n}'
    : '\nint main(void) {\n  return 0;\n}'

  return `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <stddef.h>\n\n${emitRuntimePrelude()}\n${enumDecls}\n\n${implementationFns}\n\n${letDecls}\n\n${body}${mainWrapper}\n`
}
