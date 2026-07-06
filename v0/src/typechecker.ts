import { createDiagnostic, Diagnostic } from './diagnostics.js'
import { IrProgram } from './ir.js'
import { EnumDecl, Expr, FunctionDecl, FunctionTypeReference, ImplementationDecl, LetDecl, MatchExpr, Pattern, TypeAnnotation, TypeclassDecl } from './ast.js'

interface EnumInfo {
  enumName: string
  variants: string[]
  typeParams: string[]
}

interface VariantInfo {
  enumName: string
  typeParams: string[]
  fields: TypeAnnotation[]
}

export class TypeChecker {
  private enumInfos = new Map<string, EnumInfo>()
  private variantInfos = new Map<string, VariantInfo>()
  private readonly builtinSignatures = this.createBuiltinSignatures()

  check(program: IrProgram, filePath: string): Diagnostic[] {
    this.enumInfos = new Map()
    this.variantInfos = new Map()
    const diagnostics: Diagnostic[] = []
    const functionNames = new Set<string>()
    const enumNames = new Set<string>()
    const constructors = new Map<string, number>()
    const typeclasses = new Map<string, TypeclassDecl>()
    const functionSignatures = this.collectFunctionSignatures(program)

    for (const item of program.body) {
      diagnostics.push(...this.checkItem(item, filePath, functionNames, enumNames, constructors, typeclasses, functionSignatures))
    }

    const implementations = program.body.filter(item => item.type === 'ImplementationDecl') as ImplementationDecl[]

    for (const item of program.body) {
      if (item.type === 'ImplementationDecl') {
        diagnostics.push(...this.checkImplementationDecl(item, filePath, typeclasses, implementations))
      }
    }

    for (const typeclassDecl of typeclasses.values()) {
      diagnostics.push(...this.checkTypeclassConstraints(typeclassDecl, filePath, typeclasses))
    }
    diagnostics.push(...this.checkGenericCalls(program, filePath, typeclasses, implementations))

    return diagnostics
  }

  private checkItem(
    item: IrProgram['body'][number],
    filePath: string,
    functionNames: Set<string>,
    enumNames: Set<string>,
    constructors: Map<string, number>,
    typeclasses: Map<string, TypeclassDecl>,
    functionSignatures: Map<string, FunctionTypeReference>,
  ): Diagnostic[] {
    if (item.type === 'EnumDecl') {
      return this.checkEnumDecl(item, filePath, enumNames, constructors)
    }

    if (item.type === 'TypeclassDecl') {
      return this.checkTypeclassDecl(item, filePath, typeclasses)
    }

    if (item.type === 'ImplementationDecl') {
      return []
    }

    if (item.type === 'FunctionDecl') {
      return this.checkFunctionDecl(item, filePath, functionNames, functionSignatures)
    }

    if (item.type === 'LetDecl') {
      return this.checkLetDecl(item, filePath, functionSignatures, new Map())
    }

    if (item.type === 'MatchExpr') {
      return this.checkMatchExpr(item, filePath, constructors)
    }

    if (item.type === 'ExprStmt') {
      return this.checkExpressionStatement(item.expr, filePath, functionSignatures, new Map())
    }

    return []
  }

  private checkEnumDecl(
    enumDecl: EnumDecl,
    filePath: string,
    enumNames: Set<string>,
    constructors: Map<string, number>,
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    if (enumNames.has(enumDecl.name)) {
      diagnostics.push(createDiagnostic('ARX2001', `Duplicate enum ${enumDecl.name}.`, filePath))
    }
    enumNames.add(enumDecl.name)
    const variantNames: string[] = enumDecl.variants.map(v => v.name)
    for (const variant of enumDecl.variants) {
      constructors.set(variant.name, variant.fields.length)
      this.enumInfos.set(variant.name, { enumName: enumDecl.name, variants: variantNames, typeParams: enumDecl.typeParams })
      this.variantInfos.set(variant.name, { enumName: enumDecl.name, typeParams: enumDecl.typeParams, fields: variant.fields })
    }
    return diagnostics
  }

  private checkFunctionDecl(
    functionDecl: FunctionDecl,
    filePath: string,
    functionNames: Set<string>,
    functionSignatures: Map<string, FunctionTypeReference>,
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    if (functionNames.has(functionDecl.name)) {
      diagnostics.push(createDiagnostic('ARX2002', `Duplicate function ${functionDecl.name}.`, filePath))
    }
    functionNames.add(functionDecl.name)

    const paramNames = new Set<string>()
    for (const param of functionDecl.params) {
      if (paramNames.has(param.name)) {
        diagnostics.push(createDiagnostic('ARX2003', `Duplicate parameter ${param.name} in ${functionDecl.name}.`, filePath))
      }
      paramNames.add(param.name)
    }

    diagnostics.push(...this.checkFunctionBody(functionDecl, filePath, functionSignatures))

    return diagnostics
  }

  private checkTypeclassDecl(
    typeclassDecl: TypeclassDecl,
    filePath: string,
    typeclasses: Map<string, TypeclassDecl>,
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    if (typeclasses.has(typeclassDecl.name)) {
      diagnostics.push(createDiagnostic('ARX2008', `Duplicate typeclass ${typeclassDecl.name}.`, filePath))
    }
    typeclasses.set(typeclassDecl.name, typeclassDecl)

    const methodNames = new Set<string>()
    for (const method of typeclassDecl.methods) {
      if (methodNames.has(method.name)) {
        diagnostics.push(createDiagnostic('ARX2006', `Duplicate typeclass method ${method.name} in ${typeclassDecl.name}.`, filePath))
      }
      methodNames.add(method.name)
      diagnostics.push(...this.validateTypeclassMethod(typeclassDecl, method, filePath))
    }
    return diagnostics
  }

  private checkImplementationDecl(
    implementationDecl: ImplementationDecl,
    filePath: string,
    typeclasses: Map<string, TypeclassDecl>,
    implementations: ImplementationDecl[],
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    const methodNames = new Set<string>()

    const typeclassDecl = typeclasses.get(implementationDecl.typeclassName)
    if (!typeclassDecl) {
      diagnostics.push(createDiagnostic('ARX2009', `Implementation references unknown typeclass ${implementationDecl.typeclassName}.`, filePath))
      return diagnostics
    }

    diagnostics.push(...this.checkImplementationConstraints(implementationDecl, typeclassDecl, filePath, typeclasses, implementations))

    const typeMap = this.typeclassTypeMap(typeclassDecl, implementationDecl)

    for (const method of implementationDecl.methods) {
      if (methodNames.has(method.name)) {
        diagnostics.push(createDiagnostic('ARX2007', `Duplicate implementation method ${method.name} in ${implementationDecl.typeclassName}.`, filePath))
      }
      methodNames.add(method.name)

      diagnostics.push(...this.validateImplementationMethod(implementationDecl, typeclassDecl, method.name, method.value, filePath, typeMap))
    }

    diagnostics.push(...this.checkRequiredImplementationMethods(implementationDecl, typeclassDecl, methodNames, filePath))

    return diagnostics
  }

  private checkImplementationConstraints(
    implementationDecl: ImplementationDecl,
    typeclassDecl: TypeclassDecl,
    filePath: string,
    typeclasses: Map<string, TypeclassDecl>,
    implementations: ImplementationDecl[],
  ): Diagnostic[] {
    const args: TypeAnnotation[] = implementationDecl.typeParams.map(typeName => ({ type: 'TypeReference', name: typeName, typeArgs: [] }))
    if (args.length !== typeclassDecl.typeParams.length) {
      return []
    }

    const hasTypeVariables = implementationDecl.typeParams.some(typeName => this.isTypeVariableName(typeName))
    if (hasTypeVariables) {
      return []
    }

    if (!this.constraintsSatisfiedForTypeclass(typeclassDecl, args, typeclasses, implementations, new Set())) {
      const rendered = args.map(typeArg => this.typeAnnotationKey(typeArg)).join(', ')
      return [
        createDiagnostic(
          'ARX2024',
          `Implementation ${implementationDecl.typeclassName}<${rendered}> does not satisfy where constraints declared by ${implementationDecl.typeclassName}.`,
          filePath,
        ),
      ]
    }

    return []
  }

  private collectFunctionSignatures(program: IrProgram): Map<string, FunctionTypeReference> {
    const signatures = new Map<string, FunctionTypeReference>(this.builtinSignatures)
    for (const item of program.body) {
      if (item.type !== 'FunctionDecl') {
        continue
      }
      signatures.set(item.name, this.signatureFromFunctionDecl(item))
    }
    return signatures
  }

  private signatureFromFunctionDecl(functionDecl: FunctionDecl): FunctionTypeReference {
    if (functionDecl.returnType?.type === 'FunctionTypeReference') {
      const declared = functionDecl.returnType
      return {
        type: 'FunctionTypeReference',
        params: functionDecl.params.map((param, index) => param.paramType ?? declared.params[index] ?? this.unknownType()),
        returnType: declared.returnType,
      }
    }

    return {
      type: 'FunctionTypeReference',
      params: functionDecl.params.map(param => param.paramType ?? this.unknownType()),
      returnType: functionDecl.returnType ?? this.unknownType(),
    }
  }

  private checkFunctionBody(
    functionDecl: FunctionDecl,
    filePath: string,
    functionSignatures: Map<string, FunctionTypeReference>,
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    const scope = new Map<string, TypeAnnotation>()
    for (const param of functionDecl.params) {
      scope.set(param.name, param.paramType ?? this.unknownType())
    }

    const expectedReturn = this.signatureFromFunctionDecl(functionDecl).returnType
    for (const statement of functionDecl.body.body) {
      if (statement.type === 'LetDecl') {
        diagnostics.push(...this.checkLetDecl(statement, filePath, functionSignatures, scope))
        continue
      }

      if (statement.type === 'ExprStmt') {
        diagnostics.push(...this.checkExpressionStatement(statement.expr, filePath, functionSignatures, scope))
        continue
      }

      diagnostics.push(...this.checkReturnExpr(statement.value, expectedReturn, filePath, functionSignatures, scope, functionDecl.name))
    }

    return diagnostics
  }

  private checkReturnExpr(
    returnExpr: Expr | undefined,
    expectedReturn: TypeAnnotation,
    filePath: string,
    functionSignatures: Map<string, FunctionTypeReference>,
    scope: Map<string, TypeAnnotation>,
    functionName: string,
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    if (!returnExpr) {
      return diagnostics
    }

    const actual = this.inferExprType(returnExpr, functionSignatures, scope, diagnostics, filePath)
    if (!this.compatibleType(expectedReturn, actual)) {
      diagnostics.push(
        createDiagnostic(
          'ARX2027',
          `Return type mismatch in ${functionName}: expected ${this.typeAnnotationKey(expectedReturn)}, got ${this.typeAnnotationKey(actual)}.`,
          filePath,
        ),
      )
    }

    return diagnostics
  }

  private checkExpressionStatement(
    expr: Expr,
    filePath: string,
    functionSignatures: Map<string, FunctionTypeReference>,
    scope: Map<string, TypeAnnotation>,
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    this.inferExprType(expr, functionSignatures, scope, diagnostics, filePath)
    return diagnostics
  }

  private checkLetDecl(
    letDecl: LetDecl,
    filePath: string,
    functionSignatures: Map<string, FunctionTypeReference>,
    scope: Map<string, TypeAnnotation>,
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    const valueType = this.inferExprType(letDecl.value, functionSignatures, scope, diagnostics, filePath)

    if (letDecl.declaredType && !this.compatibleType(letDecl.declaredType, valueType)) {
      diagnostics.push(
        createDiagnostic(
          'ARX2028',
          `Let binding ${letDecl.name} expected type ${this.typeAnnotationKey(letDecl.declaredType)}, got ${this.typeAnnotationKey(valueType)}.`,
          filePath,
        ),
      )
    }

    scope.set(letDecl.name, letDecl.declaredType ?? valueType)
    return diagnostics
  }

  private checkMatchExpr(matchExpr: MatchExpr, filePath: string, constructors: Map<string, number>): Diagnostic[] {
    return [
      ...this.checkPattern(matchExpr.arms.map(arm => arm.pattern), constructors, filePath),
      ...this.checkMatchExhaustiveness(matchExpr, filePath),
      ...this.checkMatchUnreachable(matchExpr, filePath),
    ]
  }

  private checkMatchExhaustiveness(matchExpr: MatchExpr, filePath: string): Diagnostic[] {
    const firstConstructorArm = matchExpr.arms.find(arm => arm.pattern.type === 'ConstructorPattern')
    if (!firstConstructorArm) {
      return []
    }

    const firstPattern = firstConstructorArm.pattern
    if (firstPattern.type !== 'ConstructorPattern') {
      return []
    }

    const enumInfo = this.enumInfos.get(firstPattern.name)
    if (!enumInfo) {
      return []
    }

    const hasCatchAll = matchExpr.arms.some(arm =>
      (arm.pattern.type === 'WildcardPattern' || arm.pattern.type === 'IdentifierPattern') && arm.guard == null,
    )
    if (hasCatchAll) {
      return []
    }

    const coveredConstructors = new Set<string>()
    for (const arm of matchExpr.arms) {
      if (arm.pattern.type === 'ConstructorPattern' && arm.guard == null) {
        coveredConstructors.add(arm.pattern.name)
      }
    }

    const missing = enumInfo.variants.filter(v => !coveredConstructors.has(v))
    if (missing.length > 0) {
      return [
        createDiagnostic(
          'ARX2033',
          `Non-exhaustive match on ${enumInfo.enumName}: missing patterns for ${missing.join(', ')}.`,
          filePath,
        ),
      ]
    }

    return []
  }

  private checkMatchUnreachable(matchExpr: MatchExpr, filePath: string): Diagnostic[] {
    return [
      ...this.checkCatchAllUnreachable(matchExpr, filePath),
      ...this.checkDuplicateConstructorUnreachable(matchExpr, filePath),
    ]
  }

  private checkCatchAllUnreachable(matchExpr: MatchExpr, filePath: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    let seenUnguardedCatchAll = false

    for (const arm of matchExpr.arms) {
      if (this.isUnguardedCatchAll(arm.pattern, arm.guard)) {
        if (seenUnguardedCatchAll) {
          diagnostics.push(
            createDiagnostic('ARX2034', `Unreachable match arm: a wildcard or catch-all pattern already appeared earlier.`, filePath),
          )
        }
        seenUnguardedCatchAll = true
        continue
      }

      if (seenUnguardedCatchAll) {
        diagnostics.push(
          createDiagnostic('ARX2034', `Unreachable match arm after wildcard or catch-all pattern.`, filePath),
        )
      }
    }

    return diagnostics
  }

  private checkDuplicateConstructorUnreachable(matchExpr: MatchExpr, filePath: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    const coveredConstructors = new Set<string>()

    for (const arm of matchExpr.arms) {
      if (arm.pattern.type !== 'ConstructorPattern') {
        continue
      }

      if (coveredConstructors.has(arm.pattern.name)) {
        diagnostics.push(
          createDiagnostic('ARX2034', `Unreachable match arm: pattern ${arm.pattern.name} is already covered.`, filePath),
        )
      }
      if (arm.guard == null) {
        coveredConstructors.add(arm.pattern.name)
      }
    }

    return diagnostics
  }

  private isUnguardedCatchAll(pattern: Pattern, guard: Expr | undefined): boolean {
    if (guard != null) {
      return false
    }
    return pattern.type === 'WildcardPattern' || pattern.type === 'IdentifierPattern'
  }

  private checkTypeclassConstraints(
    typeclassDecl: TypeclassDecl,
    filePath: string,
    typeclasses: Map<string, TypeclassDecl>,
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    for (const constraint of typeclassDecl.constraints) {
      const constrainedTypeclass = typeclasses.get(constraint.name)
      if (!constrainedTypeclass) {
        diagnostics.push(createDiagnostic('ARX2017', `Typeclass ${typeclassDecl.name} references unknown constraint ${constraint.name}.`, filePath))
        continue
      }

      if (constrainedTypeclass.typeParams.length !== constraint.typeArgs.length) {
        diagnostics.push(
          createDiagnostic(
            'ARX2018',
            `Constraint ${constraint.name} in typeclass ${typeclassDecl.name} expects ${constrainedTypeclass.typeParams.length} type arguments, but got ${constraint.typeArgs.length}.`,
            filePath,
          ),
        )
      }
    }
    return diagnostics
  }

  private inferExprType(
    expr: Expr,
    functionSignatures: Map<string, FunctionTypeReference>,
    scope: Map<string, TypeAnnotation>,
    diagnostics: Diagnostic[],
    filePath: string,
  ): TypeAnnotation {
    switch (expr.type) {
      case 'NumberLiteral':
        return { type: 'TypeReference', name: expr.isFloat ? 'Float' : 'Int', typeArgs: [] }
      case 'StringLiteral':
        return { type: 'TypeReference', name: 'Array', typeArgs: [{ type: 'TypeReference', name: 'Char', typeArgs: [] }] }
      case 'CharLiteral':
        return { type: 'TypeReference', name: 'Char', typeArgs: [] }
      case 'BooleanLiteral':
        return { type: 'TypeReference', name: 'Bool', typeArgs: [] }
      case 'IdentifierExpr':
        return this.inferIdentifierExprType(expr.name, functionSignatures, scope)
      case 'ArrayLiteral':
        return this.inferArrayLiteralType(expr, functionSignatures, scope, diagnostics, filePath)
      case 'LambdaExpr':
        return this.inferLambdaExprType(expr, functionSignatures, scope, diagnostics, filePath)
      case 'CallExpr':
        return this.inferCallExprType(expr, functionSignatures, scope, diagnostics, filePath)
      case 'BlockExpr':
        return this.inferBlockExprType(expr, functionSignatures, scope, diagnostics, filePath)
      case 'MatchExpr':
        return this.inferMatchExprType(expr, functionSignatures, scope, diagnostics, filePath)
      case 'ReturnExpr':
        return expr.value ? this.inferExprType(expr.value, functionSignatures, scope, diagnostics, filePath) : this.unknownType()
      case 'MemberExpr':
        this.inferExprType(expr.object, functionSignatures, scope, diagnostics, filePath)
        return this.unknownType()
      case 'ConstructorExpr':
        return this.inferConstructorExprType(expr, functionSignatures, scope, diagnostics, filePath)
      default:
        return this.unknownType()
    }
  }

  private inferIdentifierExprType(
    name: string,
    functionSignatures: Map<string, FunctionTypeReference>,
    scope: Map<string, TypeAnnotation>,
  ): TypeAnnotation {
    const scoped = scope.get(name)
    if (scoped) {
      return scoped
    }
    const signature = functionSignatures.get(name)
    if (signature) {
      return signature
    }
    const builtin = this.builtinSignatures.get(name)
    if (builtin) {
      return builtin
    }
    return this.unknownType()
  }

  private createBuiltinSignatures(): Map<string, FunctionTypeReference> {
    return new Map<string, FunctionTypeReference>([
      ['print', this.fnType([this.typeRef('T')], this.ioType(this.typeRef('Unit')))],
      ['printLine', this.fnType([this.typeRef('T')], this.ioType(this.typeRef('Unit')))],
      ['intToString', this.fnType([this.typeRef('Int')], this.typeRef('String'))],
      ['concat', this.fnType([this.typeRef('String'), this.typeRef('String')], this.typeRef('String'))],
      ['arrayLength', this.fnType([this.typeRef('Array', this.typeRef('T'))], this.typeRef('Int'))],
      ['arrayGet', this.fnType([this.typeRef('Array', this.typeRef('T')), this.typeRef('Int')], this.typeRef('T'))],
      ['add', this.fnType([this.typeRef('Int'), this.typeRef('Int')], this.typeRef('Int'))],
      ['sub', this.fnType([this.typeRef('Int'), this.typeRef('Int')], this.typeRef('Int'))],
      ['mul', this.fnType([this.typeRef('Int'), this.typeRef('Int')], this.typeRef('Int'))],
      ['div', this.fnType([this.typeRef('Int'), this.typeRef('Int')], this.typeRef('Int'))],
      ['mod', this.fnType([this.typeRef('Int'), this.typeRef('Int')], this.typeRef('Int'))],
      ['eq', this.fnType([this.typeRef('Int'), this.typeRef('Int')], this.typeRef('Bool'))],
      ['lt', this.fnType([this.typeRef('Int'), this.typeRef('Int')], this.typeRef('Bool'))],
      ['gt', this.fnType([this.typeRef('Int'), this.typeRef('Int')], this.typeRef('Bool'))],
      ['lte', this.fnType([this.typeRef('Int'), this.typeRef('Int')], this.typeRef('Bool'))],
      ['gte', this.fnType([this.typeRef('Int'), this.typeRef('Int')], this.typeRef('Bool'))],
      ['not', this.fnType([this.typeRef('Bool')], this.typeRef('Bool'))],
      ['and', this.fnType([this.typeRef('Bool'), this.typeRef('Bool')], this.typeRef('Bool'))],
      ['or', this.fnType([this.typeRef('Bool'), this.typeRef('Bool')], this.typeRef('Bool'))],
    ])
  }

  private fnType(params: TypeAnnotation[], returnType: TypeAnnotation): FunctionTypeReference {
    return {
      type: 'FunctionTypeReference',
      params,
      returnType,
    }
  }

  private ioType(inner: TypeAnnotation): TypeAnnotation {
    return this.typeRef('IO', inner)
  }

  private typeRef(name: string, ...typeArgs: TypeAnnotation[]): TypeAnnotation {
    return {
      type: 'TypeReference',
      name,
      typeArgs,
    }
  }

  private inferConstructorExprType(
    expr: Extract<Expr, { type: 'ConstructorExpr' }>,
    functionSignatures: Map<string, FunctionTypeReference>,
    scope: Map<string, TypeAnnotation>,
    diagnostics: Diagnostic[],
    filePath: string,
  ): TypeAnnotation {
    const argTypes = expr.args.map(arg => this.inferExprType(arg, functionSignatures, scope, diagnostics, filePath))
    const variantInfo = this.variantInfos.get(expr.name)

    if (!variantInfo) {
      return this.unknownType()
    }

    if (variantInfo.fields.length !== argTypes.length) {
      diagnostics.push(
        createDiagnostic(
          'ARX2035',
          `Constructor ${expr.name} expects ${variantInfo.fields.length} arguments, but got ${argTypes.length}.`,
          filePath,
        ),
      )
      return { type: 'TypeReference', name: variantInfo.enumName, typeArgs: variantInfo.typeParams.map(() => this.unknownType()) }
    }

    for (let index = 0; index < variantInfo.fields.length; index += 1) {
      const fieldType = variantInfo.fields[index]
      const isGenericField = fieldType.type === 'TypeReference' && this.isTypeVariableName(fieldType.name) && fieldType.typeArgs.length === 0
      if (!isGenericField && !this.compatibleType(fieldType, argTypes[index])) {
        diagnostics.push(
          createDiagnostic(
            'ARX2036',
            `Constructor ${expr.name} argument ${index + 1} expects ${this.typeAnnotationKey(fieldType)}, got ${this.typeAnnotationKey(argTypes[index])}.`,
            filePath,
          ),
        )
      }
    }

    const typeArgs = this.inferConstructorTypeArgs(variantInfo, argTypes)
    return { type: 'TypeReference', name: variantInfo.enumName, typeArgs }
  }

  private inferConstructorTypeArgs(variantInfo: VariantInfo, argTypes: TypeAnnotation[]): TypeAnnotation[] {
    if (variantInfo.typeParams.length === 0) {
      return []
    }

    const map = new Map<string, TypeAnnotation>()
    for (let index = 0; index < variantInfo.fields.length; index += 1) {
      this.inferTypeBindings(variantInfo.fields[index], argTypes[index], map)
    }

    return variantInfo.typeParams.map(param => map.get(param) ?? this.unknownType())
  }

  private inferArrayLiteralType(
    expr: Extract<Expr, { type: 'ArrayLiteral' }>,
    functionSignatures: Map<string, FunctionTypeReference>,
    scope: Map<string, TypeAnnotation>,
    diagnostics: Diagnostic[],
    filePath: string,
  ): TypeAnnotation {
    if (expr.elements.length === 0) {
      return { type: 'TypeReference', name: 'Array', typeArgs: [this.unknownType()] }
    }

    const firstType = this.inferExprType(expr.elements[0], functionSignatures, scope, diagnostics, filePath)
    for (let index = 1; index < expr.elements.length; index += 1) {
      const nextType = this.inferExprType(expr.elements[index], functionSignatures, scope, diagnostics, filePath)
      if (!this.compatibleType(firstType, nextType)) {
        diagnostics.push(
          createDiagnostic(
            'ARX2030',
            `Array literal has incompatible element types: ${this.typeAnnotationKey(firstType)} and ${this.typeAnnotationKey(nextType)}.`,
            filePath,
          ),
        )
        return { type: 'TypeReference', name: 'Array', typeArgs: [this.unknownType()] }
      }
    }

    return { type: 'TypeReference', name: 'Array', typeArgs: [firstType] }
  }

  private inferLambdaExprType(
    expr: Extract<Expr, { type: 'LambdaExpr' }>,
    functionSignatures: Map<string, FunctionTypeReference>,
    scope: Map<string, TypeAnnotation>,
    diagnostics: Diagnostic[],
    filePath: string,
  ): TypeAnnotation {
    const nestedScope = new Map(scope)
    for (const param of expr.params) {
      nestedScope.set(param.name, param.paramType ?? this.unknownType())
    }
    this.inferExprType(expr.body, functionSignatures, nestedScope, diagnostics, filePath)
    return {
      type: 'FunctionTypeReference',
      params: expr.params.map(param => param.paramType ?? this.unknownType()),
      returnType: expr.returnType ?? this.unknownType(),
    }
  }

  private inferBlockExprType(
    expr: Extract<Expr, { type: 'BlockExpr' }>,
    functionSignatures: Map<string, FunctionTypeReference>,
    scope: Map<string, TypeAnnotation>,
    diagnostics: Diagnostic[],
    filePath: string,
  ): TypeAnnotation {
    const nestedScope = new Map(scope)
    let lastReturnType: TypeAnnotation = this.unknownType()
    let hasExplicitReturn = false
    for (const statement of expr.body) {
      if (statement.type === 'LetDecl') {
        diagnostics.push(...this.checkLetDecl(statement, filePath, functionSignatures, nestedScope))
        continue
      }
      if (statement.type === 'ExprStmt') {
        this.inferExprType(statement.expr, functionSignatures, nestedScope, diagnostics, filePath)
        continue
      }
      hasExplicitReturn = true
      lastReturnType = statement.value
        ? this.inferExprType(statement.value, functionSignatures, nestedScope, diagnostics, filePath)
        : this.unknownType()
    }
    return hasExplicitReturn ? lastReturnType : this.unknownType()
  }

  private inferMatchExprType(
    expr: Extract<Expr, { type: 'MatchExpr' }>,
    functionSignatures: Map<string, FunctionTypeReference>,
    scope: Map<string, TypeAnnotation>,
    diagnostics: Diagnostic[],
    filePath: string,
  ): TypeAnnotation {
    this.inferExprType(expr.value, functionSignatures, scope, diagnostics, filePath)
    const matchDiags = [
      ...this.checkMatchExhaustiveness(expr, filePath),
      ...this.checkMatchUnreachable(expr, filePath),
    ]
    for (const d of matchDiags) {
      diagnostics.push(d)
    }
    if (expr.arms.length === 0) {
      return this.unknownType()
    }

    const first = this.inferExprType(expr.arms[0].body, functionSignatures, scope, diagnostics, filePath)
    for (let index = 1; index < expr.arms.length; index += 1) {
      const armType = this.inferExprType(expr.arms[index].body, functionSignatures, scope, diagnostics, filePath)
      if (!this.compatibleType(first, armType)) {
        diagnostics.push(
          createDiagnostic(
            'ARX2031',
            `Match arms have incompatible result types: ${this.typeAnnotationKey(first)} and ${this.typeAnnotationKey(armType)}.`,
            filePath,
          ),
        )
        return this.unknownType()
      }
    }

    return first
  }

  private inferCallExprType(
    expr: Extract<Expr, { type: 'CallExpr' }>,
    functionSignatures: Map<string, FunctionTypeReference>,
    scope: Map<string, TypeAnnotation>,
    diagnostics: Diagnostic[],
    filePath: string,
  ): TypeAnnotation {
    const calleeType = this.instantiateCalleeType(expr, functionSignatures, scope, diagnostics, filePath)
    const argTypes = expr.args.map(arg => this.inferExprType(arg, functionSignatures, scope, diagnostics, filePath))

    if (calleeType.type !== 'FunctionTypeReference') {
      return this.unknownType()
    }

    if (calleeType.params.length !== argTypes.length) {
      diagnostics.push(
        createDiagnostic(
          'ARX2025',
          `Call expects ${calleeType.params.length} arguments, but got ${argTypes.length}.`,
          filePath,
        ),
      )
      return calleeType.returnType
    }

    for (let index = 0; index < calleeType.params.length; index += 1) {
      if (!this.compatibleType(calleeType.params[index], argTypes[index])) {
        diagnostics.push(
          createDiagnostic(
            'ARX2026',
            `Call argument ${index + 1} expects ${this.typeAnnotationKey(calleeType.params[index])}, got ${this.typeAnnotationKey(argTypes[index])}.`,
            filePath,
          ),
        )
      }
    }

    return calleeType.returnType
  }

  private instantiateCalleeType(
    expr: Extract<Expr, { type: 'CallExpr' }>,
    functionSignatures: Map<string, FunctionTypeReference>,
    scope: Map<string, TypeAnnotation>,
    diagnostics: Diagnostic[],
    filePath: string,
  ): TypeAnnotation {
    const argTypes = expr.args.map(arg => this.inferExprType(arg, functionSignatures, scope, diagnostics, filePath))
    const calleeType = this.inferExprType(expr.callee, functionSignatures, scope, diagnostics, filePath)
    if (calleeType.type !== 'FunctionTypeReference') {
      return calleeType
    }

    if (expr.callee.type !== 'IdentifierExpr') {
      return calleeType
    }

    const signature = functionSignatures.get(expr.callee.name)
    if (!signature) {
      return calleeType
    }

    const typeVars = this.collectTypeVariablesInOrder(signature)
    if (typeVars.length === 0) {
      return signature
    }

    if (expr.genericArgs && expr.genericArgs.length > 0) {
      if (typeVars.length !== expr.genericArgs.length) {
        diagnostics.push(
          createDiagnostic(
            'ARX2029',
            `Generic call ${expr.callee.name}<...> expects ${typeVars.length} type arguments, but got ${expr.genericArgs.length}.`,
            filePath,
          ),
        )
        return signature
      }

      const map = new Map<string, TypeAnnotation>()
      for (let index = 0; index < typeVars.length; index += 1) {
        map.set(typeVars[index], expr.genericArgs[index])
      }

      return this.substituteTypeVars(signature, map)
    }

    const inferred = this.inferTypeArgumentsFromCall(signature, argTypes)
    if (!inferred.ok) {
      diagnostics.push(
        createDiagnostic(
          'ARX2032',
          `Cannot infer consistent generic type arguments for call to ${expr.callee.name}.`,
          filePath,
        ),
      )
      return signature
    }

    return this.substituteTypeVars(signature, inferred.map)
  }

  private inferTypeArgumentsFromCall(
    signature: FunctionTypeReference,
    argTypes: TypeAnnotation[],
  ): { ok: boolean; map: Map<string, TypeAnnotation> } {
    const map = new Map<string, TypeAnnotation>()
    const count = Math.min(signature.params.length, argTypes.length)

    for (let index = 0; index < count; index += 1) {
      // Apply bindings gathered so far to get a more refined expected type
      const refinedParam = map.size > 0 ? this.substituteTypeVars(signature.params[index], map) : signature.params[index]
      const actualType = argTypes[index]
      if (!this.isUnknownType(actualType) && !this.inferTypeBindings(refinedParam, actualType, map)) {
        return { ok: false, map: new Map() }
      }
    }

    return { ok: true, map }
  }

  private inferTypeBindings(
    expected: TypeAnnotation,
    actual: TypeAnnotation,
    map: Map<string, TypeAnnotation>,
  ): boolean {
    // Unknowns propagate silently — don't treat as conflict
    if (this.isUnknownType(actual) || this.isUnknownType(expected)) {
      return true
    }

    if (expected.type === 'TypeReference' && this.isTypeVariableName(expected.name) && expected.typeArgs.length === 0) {
      return this.bindTypeVariable(expected.name, actual, map)
    }

    if (expected.type === 'TypeReference' && actual.type === 'TypeReference') {
      return this.inferTypeReferenceBindings(expected, actual, map)
    }

    if (expected.type === 'FunctionTypeReference' && actual.type === 'FunctionTypeReference') {
      return this.inferFunctionTypeBindings(expected, actual, map)
    }

    // Structural mismatch (e.g. TypeReference vs FunctionTypeReference):
    // treat as non-inferable, not as a hard conflict
    return true
  }

  private bindTypeVariable(name: string, actual: TypeAnnotation, map: Map<string, TypeAnnotation>): boolean {
    if (this.isUnknownType(actual)) {
      return true
    }
    const previous = map.get(name)
    if (!previous || this.isUnknownType(previous)) {
      map.set(name, actual)
      return true
    }
    return this.compatibleType(previous, actual) && this.compatibleType(actual, previous)
  }

  private inferTypeReferenceBindings(
    expected: Extract<TypeAnnotation, { type: 'TypeReference' }>,
    actual: Extract<TypeAnnotation, { type: 'TypeReference' }>,
    map: Map<string, TypeAnnotation>,
  ): boolean {
    if (expected.name !== actual.name || expected.typeArgs.length !== actual.typeArgs.length) {
      return false
    }

    for (let index = 0; index < expected.typeArgs.length; index += 1) {
      if (!this.inferTypeBindings(expected.typeArgs[index], actual.typeArgs[index], map)) {
        return false
      }
    }

    return true
  }

  private inferFunctionTypeBindings(
    expected: Extract<TypeAnnotation, { type: 'FunctionTypeReference' }>,
    actual: Extract<TypeAnnotation, { type: 'FunctionTypeReference' }>,
    map: Map<string, TypeAnnotation>,
  ): boolean {
    if (expected.params.length !== actual.params.length) {
      return false
    }

    for (let index = 0; index < expected.params.length; index += 1) {
      if (!this.inferTypeBindings(expected.params[index], actual.params[index], map)) {
        return false
      }
    }

    return this.inferTypeBindings(expected.returnType, actual.returnType, map)
  }

  private collectTypeVariablesInOrder(signature: FunctionTypeReference): string[] {
    const ordered: string[] = []
    const seen = new Set<string>()

    for (const param of signature.params) {
      this.collectTypeVariables(param, ordered, seen)
    }
    this.collectTypeVariables(signature.returnType, ordered, seen)

    return ordered
  }

  private collectTypeVariables(type: TypeAnnotation, ordered: string[], seen: Set<string>): void {
    if (type.type === 'TypeReference') {
      if (this.isTypeVariableName(type.name) && !seen.has(type.name)) {
        seen.add(type.name)
        ordered.push(type.name)
      }
      for (const arg of type.typeArgs) {
        this.collectTypeVariables(arg, ordered, seen)
      }
      return
    }

    for (const param of type.params) {
      this.collectTypeVariables(param, ordered, seen)
    }
    this.collectTypeVariables(type.returnType, ordered, seen)
  }

  private checkGenericCalls(
    program: IrProgram,
    filePath: string,
    typeclasses: Map<string, TypeclassDecl>,
    implementations: ImplementationDecl[],
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    const methodOwners = this.buildMethodOwners(typeclasses)

    for (const item of program.body) {
      const rootExprs = this.expressionsFromTopLevel(item)
      for (const rootExpr of rootExprs) {
        diagnostics.push(...this.checkGenericCallsInExpr(rootExpr, filePath, methodOwners, typeclasses, implementations))
      }
    }

    return diagnostics
  }

  private buildMethodOwners(typeclasses: Map<string, TypeclassDecl>): Map<string, string[]> {
    const owners = new Map<string, string[]>()
    for (const typeclassDecl of typeclasses.values()) {
      for (const method of typeclassDecl.methods) {
        const list = owners.get(method.name) ?? []
        list.push(typeclassDecl.name)
        owners.set(method.name, list)
      }
    }
    return owners
  }

  private expressionsFromTopLevel(item: IrProgram['body'][number]): Expr[] {
    if (item.type === 'FunctionDecl') {
      return [item.body]
    }

    if (item.type === 'LetDecl') {
      return [item.value]
    }

    if (item.type === 'MatchExpr') {
      return [item]
    }

    if (item.type === 'ImplementationDecl') {
      return item.methods.map(method => method.value)
    }

    if (item.type === 'TypeclassDecl') {
      return item.methods.flatMap(method => method.defaultValue ? [method.defaultValue] : [])
    }

    if (item.type === 'ExprStmt') {
      return [item.expr]
    }

    return []
  }

  private checkGenericCallsInExpr(
    expr: Expr,
    filePath: string,
    methodOwners: Map<string, string[]>,
    typeclasses: Map<string, TypeclassDecl>,
    implementations: ImplementationDecl[],
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = []

    if (expr.type === 'CallExpr' && expr.genericArgs && expr.genericArgs.length > 0 && expr.callee.type === 'IdentifierExpr') {
      diagnostics.push(...this.validateGenericMethodCall(expr.callee.name, expr.genericArgs, filePath, methodOwners, typeclasses, implementations))
    }

    for (const child of this.childExpressions(expr)) {
      diagnostics.push(...this.checkGenericCallsInExpr(child, filePath, methodOwners, typeclasses, implementations))
    }

    return diagnostics
  }

  private validateGenericMethodCall(
    methodName: string,
    genericArgs: TypeAnnotation[],
    filePath: string,
    methodOwners: Map<string, string[]>,
    typeclasses: Map<string, TypeclassDecl>,
    implementations: ImplementationDecl[],
  ): Diagnostic[] {
    const owners = methodOwners.get(methodName) ?? []

    if (owners.length === 0) {
      return []
    }

    if (owners.length > 1) {
      return [createDiagnostic('ARX2020', `Generic call ${methodName}<...> is ambiguous across typeclasses: ${owners.join(', ')}.`, filePath)]
    }

    const owner = owners[0]
    const ownerTypeclass = typeclasses.get(owner)
    if (!ownerTypeclass) {
      return [createDiagnostic('ARX2021', `Generic call ${methodName}<...> has no available implementation for typeclass ${owner}.`, filePath)]
    }

    const ownerImplementations = implementations.filter(implementation => implementation.typeclassName === owner)
    if (ownerImplementations.length === 0) {
      return [createDiagnostic('ARX2021', `Generic call ${methodName}<...> has no available implementation for typeclass ${owner}.`, filePath)]
    }

    const matchingImplementations = ownerImplementations.filter(implementation => this.matchesImplementationTypeArgs(implementation, genericArgs))
    if (matchingImplementations.length === 0) {
      const rendered = genericArgs.map(typeArg => this.typeAnnotationKey(typeArg)).join(', ')
      return [createDiagnostic('ARX2022', `Generic call ${methodName}<${rendered}> has no compatible implementation in typeclass ${owner}.`, filePath)]
    }

    const hasConstraintSatisfaction = matchingImplementations.length > 0
      && this.constraintsSatisfiedForTypeclass(ownerTypeclass, genericArgs, typeclasses, implementations, new Set())
    if (!hasConstraintSatisfaction) {
      const rendered = genericArgs.map(typeArg => this.typeAnnotationKey(typeArg)).join(', ')
      return [createDiagnostic('ARX2023', `Generic call ${methodName}<${rendered}> does not satisfy where constraints required by ${owner}.`, filePath)]
    }

    return []
  }

  private constraintsSatisfiedForTypeclass(
    typeclassDecl: TypeclassDecl,
    concreteArgs: TypeAnnotation[],
    typeclasses: Map<string, TypeclassDecl>,
    implementations: ImplementationDecl[],
    visiting: Set<string>,
  ): boolean {
    const key = this.constraintKey(typeclassDecl.name, concreteArgs)
    if (visiting.has(key)) {
      return true
    }

    visiting.add(key)
    const typeMap = new Map<string, TypeAnnotation>()
    const total = Math.min(typeclassDecl.typeParams.length, concreteArgs.length)
    for (let index = 0; index < total; index += 1) {
      typeMap.set(typeclassDecl.typeParams[index], concreteArgs[index])
    }

    for (const constraint of typeclassDecl.constraints) {
      const constrainedTypeclass = typeclasses.get(constraint.name)
      if (!constrainedTypeclass) {
        visiting.delete(key)
        return false
      }

      const requiredArgs = constraint.typeArgs.map(typeArg => this.substituteTypeVars(typeArg, typeMap))
      if (!this.existsImplementationWithSatisfiedConstraints(constrainedTypeclass, requiredArgs, typeclasses, implementations, visiting)) {
        visiting.delete(key)
        return false
      }
    }

    visiting.delete(key)
    return true
  }

  private existsImplementationWithSatisfiedConstraints(
    typeclassDecl: TypeclassDecl,
    concreteArgs: TypeAnnotation[],
    typeclasses: Map<string, TypeclassDecl>,
    implementations: ImplementationDecl[],
    visiting: Set<string>,
  ): boolean {
    const candidates = implementations.filter(
      implementation => implementation.typeclassName === typeclassDecl.name && this.matchesImplementationTypeArgs(implementation, concreteArgs),
    )

    if (candidates.length === 0) {
      return false
    }

    return this.constraintsSatisfiedForTypeclass(typeclassDecl, concreteArgs, typeclasses, implementations, visiting)
  }

  private constraintKey(typeclassName: string, concreteArgs: TypeAnnotation[]): string {
    return `${typeclassName}<${concreteArgs.map(typeArg => this.typeAnnotationKey(typeArg)).join(',')}>`
  }

  private matchesImplementationTypeArgs(implementation: ImplementationDecl, genericArgs: TypeAnnotation[]): boolean {
    if (implementation.typeParams.length !== genericArgs.length) {
      return false
    }

    for (let index = 0; index < implementation.typeParams.length; index += 1) {
      const expected = implementation.typeParams[index]
      const actual = this.typeAnnotationKey(genericArgs[index])

      if (this.isTypeVariableName(expected)) {
        continue
      }

      if (expected !== actual) {
        return false
      }
    }

    return true
  }

  private isTypeVariableName(name: string): boolean {
    return /^[A-Z]$/.test(name)
  }

  private typeAnnotationKey(typeAnnotation: TypeAnnotation): string {
    if (typeAnnotation.type === 'TypeReference') {
      if (typeAnnotation.typeArgs.length === 0) {
        return typeAnnotation.name
      }
      return `${typeAnnotation.name}<${typeAnnotation.typeArgs.map(arg => this.typeAnnotationKey(arg)).join(',')}>`
    }

    return `(${typeAnnotation.params.map(param => this.typeAnnotationKey(param)).join(',')})=>${this.typeAnnotationKey(typeAnnotation.returnType)}`
  }

  private childExpressions(expr: Expr): Expr[] {
    if (expr.type === 'CallExpr') {
      return [expr.callee, ...expr.args]
    }

    if (expr.type === 'MemberExpr') {
      return [expr.object]
    }

    if (expr.type === 'BlockExpr') {
      return expr.body.flatMap(item => {
        if (item.type === 'LetDecl') {
          return [item.value]
        }
        if (item.type === 'ReturnExpr') {
          return item.value ? [item.value] : []
        }
        return [item.expr]
      })
    }

    if (expr.type === 'MatchExpr') {
      return [expr.value, ...expr.arms.map(arm => arm.body)]
    }

    if (expr.type === 'ReturnExpr') {
      return expr.value ? [expr.value] : []
    }

    if (expr.type === 'ConstructorExpr') {
      return expr.args
    }

    if (expr.type === 'LambdaExpr') {
      return [expr.body]
    }

    if (expr.type === 'ArrayLiteral') {
      return expr.elements
    }

    return []
  }

  private checkPattern(patterns: Pattern[], constructors: Map<string, number>, filePath: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    for (const pattern of patterns) {
      if (pattern.type === 'ConstructorPattern') {
        const expected = constructors.get(pattern.name)
        if (expected != null && expected !== pattern.args.length) {
          diagnostics.push(createDiagnostic('ARX2005', `Pattern ${pattern.name} expects ${expected} arguments.`, filePath))
        }
      }
    }
    return diagnostics
  }

  private isFunctionSignature(signature: TypeAnnotation): signature is FunctionTypeReference {
    return signature.type === 'FunctionTypeReference'
  }

  private expectedMethodArity(signature: TypeAnnotation): number {
    return this.isFunctionSignature(signature) ? signature.params.length : 0
  }

  private exprArity(expr: Expr): number | undefined {
    if (expr.type === 'LambdaExpr') {
      return expr.params.length
    }
    return 0
  }

  private unknownType(): TypeAnnotation {
    return { type: 'TypeReference', name: '__unknown', typeArgs: [] }
  }

  private typeclassTypeMap(typeclassDecl: TypeclassDecl, implementationDecl: ImplementationDecl): Map<string, TypeAnnotation> {
    const map = new Map<string, TypeAnnotation>()
    const total = Math.min(typeclassDecl.typeParams.length, implementationDecl.typeParams.length)
    for (let index = 0; index < total; index += 1) {
      map.set(typeclassDecl.typeParams[index], {
        type: 'TypeReference',
        name: implementationDecl.typeParams[index],
        typeArgs: [],
      })
    }
    return map
  }

  private substituteTypeVars(annotation: TypeAnnotation, map: Map<string, TypeAnnotation>): TypeAnnotation {
    if (annotation.type === 'TypeReference') {
      const replacement = map.get(annotation.name)
      if (replacement) {
        return replacement
      }
      return {
        type: 'TypeReference',
        name: annotation.name,
        typeArgs: annotation.typeArgs.map(arg => this.substituteTypeVars(arg, map)),
      }
    }

    return {
      type: 'FunctionTypeReference',
      params: annotation.params.map(param => this.substituteTypeVars(param, map)),
      returnType: this.substituteTypeVars(annotation.returnType, map),
    }
  }

  private exprSignature(expr: Expr): TypeAnnotation | undefined {
    if (expr.type === 'LambdaExpr') {
      return {
        type: 'FunctionTypeReference',
        params: expr.params.map(param => param.paramType ?? this.unknownType()),
        returnType: expr.returnType ?? this.unknownType(),
      }
    }

    return {
      type: 'FunctionTypeReference',
      params: [],
      returnType: this.unknownType(),
    }
  }

  private compatibleType(expected: TypeAnnotation, actual: TypeAnnotation): boolean {
    if (this.isUnknownType(expected) || this.isUnknownType(actual)) {
      return true
    }

    if (expected.type === 'TypeReference' && actual.type === 'TypeReference') {
      return this.compatibleTypeReference(expected, actual)
    }

    if (expected.type === 'FunctionTypeReference' && actual.type === 'FunctionTypeReference') {
      return this.compatibleFunctionType(expected, actual)
    }

    return false
  }

  private compatibleSignature(declared: TypeAnnotation, provided: TypeAnnotation): boolean {
    if (!this.isFunctionSignature(declared) || !this.isFunctionSignature(provided)) {
      return false
    }
    return this.compatibleType(declared, provided)
  }

  private validateTypeclassMethod(typeclassDecl: TypeclassDecl, method: TypeclassDecl['methods'][number], filePath: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = []

    if (!this.isFunctionSignature(method.signature)) {
      diagnostics.push(createDiagnostic('ARX2012', `Method ${method.name} in ${typeclassDecl.name} must declare a function signature.`, filePath))
      return diagnostics
    }

    if (!method.defaultValue) {
      return diagnostics
    }

    diagnostics.push(...this.checkMethodArity(
      'ARX2013',
      `Default method ${method.name} in ${typeclassDecl.name}`,
      method.signature,
      method.defaultValue,
      filePath,
    ))

    const defaultSignature = this.exprSignature(method.defaultValue)
    if (defaultSignature && !this.compatibleSignature(method.signature, defaultSignature)) {
      diagnostics.push(createDiagnostic('ARX2015', `Default method ${method.name} in ${typeclassDecl.name} has incompatible signature.`, filePath))
    }

    return diagnostics
  }

  private validateImplementationMethod(
    implementationDecl: ImplementationDecl,
    typeclassDecl: TypeclassDecl,
    methodName: string,
    methodValue: Expr,
    filePath: string,
    typeMap: Map<string, TypeAnnotation>,
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    const declaredMethod = typeclassDecl.methods.find(tcMethod => tcMethod.name === methodName)
    if (!declaredMethod) {
      diagnostics.push(createDiagnostic('ARX2011', `Implementation method ${methodName} is not declared in typeclass ${implementationDecl.typeclassName}.`, filePath))
      return diagnostics
    }

    diagnostics.push(...this.checkMethodArity(
      'ARX2014',
      `Implementation method ${methodName} in ${implementationDecl.typeclassName}`,
      declaredMethod.signature,
      methodValue,
      filePath,
    ))

    const instantiatedSignature = this.substituteTypeVars(declaredMethod.signature, typeMap)
    const implementationSignature = this.exprSignature(methodValue)
    if (implementationSignature && !this.compatibleSignature(instantiatedSignature, implementationSignature)) {
      diagnostics.push(createDiagnostic('ARX2016', `Implementation method ${methodName} in ${implementationDecl.typeclassName} has incompatible parameter or return types.`, filePath))
    }

    return diagnostics
  }

  private checkRequiredImplementationMethods(
    implementationDecl: ImplementationDecl,
    typeclassDecl: TypeclassDecl,
    methodNames: Set<string>,
    filePath: string,
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    for (const method of typeclassDecl.methods) {
      const isRequired = method.defaultValue == null
      if (isRequired && !methodNames.has(method.name)) {
        diagnostics.push(createDiagnostic('ARX2010', `Missing required method ${method.name} in implementation ${implementationDecl.typeclassName}.`, filePath))
      }
    }
    return diagnostics
  }

  private checkMethodArity(
    code: string,
    subject: string,
    signature: TypeAnnotation,
    value: Expr,
    filePath: string,
  ): Diagnostic[] {
    const expectedArity = this.expectedMethodArity(signature)
    const actualArity = this.exprArity(value)
    if (actualArity != null && expectedArity !== actualArity) {
      return [createDiagnostic(code, `${subject} expects arity ${expectedArity}, but got ${actualArity}.`, filePath)]
    }
    return []
  }

  private isUnknownType(type: TypeAnnotation): boolean {
    return type.type === 'TypeReference' && type.name === '__unknown'
  }

  private compatibleTypeReference(expected: Extract<TypeAnnotation, { type: 'TypeReference' }>, actual: Extract<TypeAnnotation, { type: 'TypeReference' }>): boolean {
    if (this.isIoBridgeCompatible(expected, actual)) {
      return true
    }
    return this.compatibleTypeReferenceWithoutIoBridge(expected, actual)
  }

  private isIoBridgeCompatible(
    expected: Extract<TypeAnnotation, { type: 'TypeReference' }>,
    actual: Extract<TypeAnnotation, { type: 'TypeReference' }>,
  ): boolean {
    const expectedInner = this.unwrapIo(expected)
    const actualInner = this.unwrapIo(actual)
    if (!expectedInner && !actualInner) {
      return false
    }

    const expectedCore = expectedInner ?? expected
    const actualCore = actualInner ?? actual
    return this.compatibleTypeReferenceWithoutIoBridge(expectedCore, actualCore)
  }

  private compatibleTypeReferenceWithoutIoBridge(
    expected: Extract<TypeAnnotation, { type: 'TypeReference' }>,
    actual: Extract<TypeAnnotation, { type: 'TypeReference' }>,
  ): boolean {
    if (this.isStringLikeType(expected) && this.isStringLikeType(actual)) {
      return true
    }

    if (expected.name !== actual.name || expected.typeArgs.length !== actual.typeArgs.length) {
      return false
    }

    for (let index = 0; index < expected.typeArgs.length; index += 1) {
      if (!this.compatibleType(expected.typeArgs[index], actual.typeArgs[index])) {
        return false
      }
    }

    return true
  }

  private isStringLikeType(type: Extract<TypeAnnotation, { type: 'TypeReference' }>): boolean {
    if (type.name === 'String' && type.typeArgs.length === 0) {
      return true
    }

    return type.name === 'Array'
      && type.typeArgs.length === 1
      && type.typeArgs[0].type === 'TypeReference'
      && type.typeArgs[0].name === 'Char'
      && type.typeArgs[0].typeArgs.length === 0
  }

  private unwrapIo(type: Extract<TypeAnnotation, { type: 'TypeReference' }>): Extract<TypeAnnotation, { type: 'TypeReference' }> | undefined {
    if (type.name !== 'IO' || type.typeArgs.length !== 1) {
      return undefined
    }
    const inner = type.typeArgs[0]
    return inner.type === 'TypeReference' ? inner : undefined
  }

  private compatibleFunctionType(
    expected: Extract<TypeAnnotation, { type: 'FunctionTypeReference' }>,
    actual: Extract<TypeAnnotation, { type: 'FunctionTypeReference' }>,
  ): boolean {
    if (expected.params.length !== actual.params.length) {
      return false
    }
    for (let index = 0; index < expected.params.length; index += 1) {
      if (!this.compatibleType(expected.params[index], actual.params[index])) {
        return false
      }
    }
    return this.compatibleType(expected.returnType, actual.returnType)
  }
}