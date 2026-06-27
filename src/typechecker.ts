import type {
  CallExpr,
  Constraint,
  FunctionDecl,
  Identifier,
  ImportStmt,
  InstanceDecl,
  LetDecl,
  ListComprehension,
  MatchExpr,
  MemberExpr,
  MethodDecl,
  MethodImpl,
  Node,
  NumberLiteral,
  Param,
  Pattern,
  Program,
  TypeDecl,
  TypeclassDecl,
} from './ast.js';
import { createDiagnostic, type CompilerDiagnostic } from './diagnostics.js';

const STDLIB_FALLBACK_EXPORTS: Record<string, string[]> = {
  bool: ['Bool', 'True', 'False'],
  list: ['List', 'Nil', 'Cons', 'head', 'last', 'length', 'isEmpty', 'append'],
  show: ['Show', 'show'],
  eq: ['Eq', 'eq', 'notEq'],
  maybe: ['Maybe', 'Some', 'None', 'getOrElse'],
  result: ['Result', 'Ok', 'Err'],
  functor: ['Functor', 'map'],
  applicative: ['Applicative', 'pure', 'apply'],
  monad: ['Monad', 'flatMap'],
  monoid: ['Monoid', 'empty', 'combine'],
};

interface ModuleInfo {
  exports: string[];
  imports: string[];
}

interface TypeCheckerOptions {
  moduleInfoMap: Map<string, ModuleInfo>;
  globalTypeclasses: Map<string, TypeclassDecl>;
  globalAdtVariants?: Map<string, string[]>;
  stdlibModules?: string[];
  isStdlibSource?: boolean;
}

interface TypeTerm {
  kind: 'name' | 'var';
  name: string;
  args: TypeTerm[];
}

interface InstanceRule {
  typeclass: string;
  headArgs: TypeTerm[];
  headVarNames: Set<string>;
  constraints: Constraint[];
}

export class TypeChecker {
  private readonly options: TypeCheckerOptions;
  private readonly diagnostics: CompilerDiagnostic[] = [];
  private readonly knownFunctions = new Map<string, number>();
  private readonly knownFunctionDecls = new Map<string, FunctionDecl>();
  private readonly knownTypeDecls = new Map<string, TypeDecl>();
  private readonly knownTypeclasses = new Map<string, TypeclassDecl>();
  private readonly instanceRulesByTypeclass = new Map<string, InstanceRule[]>();
  private readonly knownConstructors = new Set<string>();
  private readonly adtVariants = new Map<string, Set<string>>();
  private readonly variantToType = new Map<string, string>();
  private readonly importedNames = new Set<string>();
  private readonly scopes: Set<string>[] = [new Set()];
  private readonly typedScopes: Map<string, TypeTerm>[] = [new Map()];
  private filePath = '';

  constructor(options: TypeCheckerOptions) {
    this.options = options;
  }

  check(program: Program, filePath: string): CompilerDiagnostic[] {
    this.filePath = filePath;
    this.diagnostics.length = 0;
    this.resetScopes();
    this.resetCollections();

    this.collectTopLevel(program);
    this.collectInstanceRules(program);
    this.collectImportedNames(program);
    this.validateTypeclassInstances(program);
    this.visitProgram(program);

    return [...this.diagnostics];
  }

  private resetScopes(): void {
    this.scopes.length = 0;
    this.typedScopes.length = 0;
    this.scopes.push(new Set());
    this.typedScopes.push(new Map());
  }

  private resetCollections(): void {
    this.knownFunctions.clear();
    this.knownFunctionDecls.clear();
    this.knownTypeDecls.clear();
    this.knownTypeclasses.clear();
    this.instanceRulesByTypeclass.clear();
    this.knownConstructors.clear();
    this.adtVariants.clear();
    this.variantToType.clear();
    this.importedNames.clear();
  }

  private collectTopLevel(program: Program): void {
    for (const [typeclassName, decl] of this.options.globalTypeclasses.entries()) {
      this.knownTypeclasses.set(typeclassName, decl);
      for (const method of decl.methods) {
        this.knownFunctions.set(method.name, method.params.length);
      }
    }

    if (this.options.globalAdtVariants) {
      for (const [typeName, variants] of this.options.globalAdtVariants.entries()) {
        this.registerAdt(typeName, variants);
      }
    }

    for (const node of program.body) {
      if (node.type === 'FunctionDecl') {
        const fn = node as FunctionDecl;
        this.knownFunctions.set(fn.name, fn.params.length);
        this.knownFunctionDecls.set(fn.name, fn);
      }

      if (node.type === 'TypeDecl') {
        const typeDecl = node as TypeDecl;
        this.knownTypeDecls.set(typeDecl.name, typeDecl);
        this.registerAdt(typeDecl.name, typeDecl.variants.map(v => v.name));
        for (const variant of typeDecl.variants) {
          this.knownFunctions.set(variant.name, variant.fields.length);
        }
      }

      if (node.type === 'TypeclassDecl') {
        const typeclassDecl = node as TypeclassDecl;
        this.knownTypeclasses.set(typeclassDecl.name, typeclassDecl);
        for (const method of typeclassDecl.methods) {
          this.knownFunctions.set(method.name, method.params.length);
        }
      }
    }

    this.knownFunctions.set('print', 1);
    this.knownConstructors.add('Nil');
    this.knownConstructors.add('Cons');
  }

  private collectInstanceRules(program: Program): void {
    for (const node of program.body) {
      if (node.type !== 'InstanceDecl') {
        continue;
      }

      const instanceDecl = node as InstanceDecl;
      const headArgs = instanceDecl.forTypes.map(typeNode => this.typeTermFromNode(typeNode)).filter((term): term is TypeTerm => !!term);
      if (headArgs.length !== instanceDecl.forTypes.length) {
        continue;
      }

      const headVarNames = new Set<string>();
      for (const arg of headArgs) {
        this.collectTypeVars(arg, headVarNames);
      }

      const rules = this.instanceRulesByTypeclass.get(instanceDecl.typeclass) ?? [];
      rules.push({
        typeclass: instanceDecl.typeclass,
        headArgs,
        headVarNames,
        constraints: instanceDecl.constraints ?? [],
      });
      this.instanceRulesByTypeclass.set(instanceDecl.typeclass, rules);
    }
  }

  private registerAdt(typeName: string, variants: string[]): void {
    const variantSet = this.adtVariants.get(typeName) ?? new Set<string>();
    for (const variant of variants) {
      variantSet.add(variant);
      this.variantToType.set(variant, typeName);
      this.knownConstructors.add(variant);
    }
    this.adtVariants.set(typeName, variantSet);
  }

  private collectImportedNames(program: Program): void {
    const explicitStdlibImports = new Set<string>();

    for (const node of program.body) {
      if (node.type !== 'ImportStmt') {
        continue;
      }

      const imp = node as ImportStmt;
      const moduleKey = imp.module.toLowerCase();
      if (this.getStdlibModules().includes(moduleKey)) {
        explicitStdlibImports.add(moduleKey);
      }

      this.registerImport(imp, false);
    }

    if (this.options.isStdlibSource) {
      return;
    }

    for (const stdlibModule of this.getStdlibModules()) {
      if (explicitStdlibImports.has(stdlibModule)) {
        continue;
      }

      const implicitImport: ImportStmt = {
        type: 'ImportStmt',
        module: stdlibModule,
        isRelative: false,
        implicit: true,
      };
      this.registerImport(implicitImport, true);
    }
  }

  private registerImport(imp: ImportStmt, implicit: boolean): void {
    const moduleInfo = this.options.moduleInfoMap.get(imp.module);
    const exports = moduleInfo?.exports ?? this.getStdlibFallbackExports(imp.module.toLowerCase());

    if (imp.alias) {
      this.assertNotReservedIdentifier(imp.alias, undefined, 'ARX1007');
      this.importedNames.add(imp.alias);
      return;
    }

    if (imp.items && imp.items.length > 0) {
      for (const item of imp.items) {
        this.assertNotReservedIdentifier(item, undefined, 'ARX1007');
        this.importedNames.add(item);
      }
      return;
    }

    const hidden = new Set(imp.hiding ?? []);
    for (const exportedName of exports) {
      if (!hidden.has(exportedName)) {
        this.assertNotReservedIdentifier(exportedName, undefined, 'ARX1007');
        this.importedNames.add(exportedName);
      }
    }

    if (!implicit) {
      const moduleName = imp.module.split('/').pop() ?? imp.module;
      this.importedNames.add(this.sanitizeModuleName(moduleName));
    }
  }

  private getStdlibModules(): string[] {
    return this.options.stdlibModules ?? Object.keys(STDLIB_FALLBACK_EXPORTS);
  }

  private getStdlibFallbackExports(moduleName: string): string[] {
    return STDLIB_FALLBACK_EXPORTS[moduleName] ?? [];
  }

  private visitProgram(program: Program): void {
    for (const node of program.body) {
      this.visitTopLevelNode(node);
    }
  }

  private visitTopLevelNode(node: Node): void {
    switch (node.type) {
      case 'FunctionDecl': {
        this.visitFunctionDecl(node as FunctionDecl);
        return;
      }
      case 'LetDecl': {
        const decl = node as LetDecl;
        this.visitExpr(decl.value);
        this.declarePattern(decl.pattern, this.inferTypeFromValue(decl.value), node);
        return;
      }
      case 'TypeDecl':
        this.validateTypeDeclConstraints(node as TypeDecl);
        return;
      case 'TypeclassDecl': {
        const typeclassDecl = node as TypeclassDecl;
        this.validateTypeclassDeclConstraints(typeclassDecl);
        this.visitTypeclassMethodBodies(typeclassDecl);
        return;
      }
      case 'InstanceDecl': {
        this.validateInstanceDeclConstraints(node as InstanceDecl);
        return;
      }
      case 'ImportStmt':
        return;
      default:
        this.visitExpr(node);
    }
  }

  private visitFunctionDecl(fn: FunctionDecl): void {
    this.withScope(() => {
      this.declareName('params');
      for (const param of fn.params) {
        const typeName = this.extractTypeName(param.paramType);
        this.declareName(param.name, typeName, fn);
      }

      if (fn.constraints) {
        for (const constraint of fn.constraints) {
          this.visitConstraint(constraint, fn);
        }
        this.validateFunctionConstraints(fn);
      }

      this.visitExpr(fn.body);
    });
  }

  private visitConstraint(constraint: Constraint, ownerNode?: Node): TypeclassDecl | undefined {
    const typeclass = this.knownTypeclasses.get(constraint.name);
    if (!typeclass) {
      this.addDiagnostic(
        'ARX3001',
        `Unknown typeclass '${constraint.name}' in where constraint.`,
        ownerNode,
        `Declare typeclass ${constraint.name}(...) or import the module that defines it.`,
      );
      return undefined;
    }

    if (constraint.args.length !== typeclass.typeParams.length) {
      this.addDiagnostic(
        'ARX3002',
        `Constraint '${constraint.name}' expects ${typeclass.typeParams.length} type argument(s), got ${constraint.args.length}.`,
        ownerNode,
      );
      return undefined;
    }

    return typeclass;
  }

  private visitExpr(node: Node | undefined): void {
    if (!node) {
      return;
    }

    switch (node.type) {
      case 'Identifier':
        this.checkIdentifierUsage(node as Identifier);
        return;

      case 'CallExpr': {
        const call = node as CallExpr;
        if (call.callee.type === 'Identifier') {
          const name = (call.callee as Identifier).name;
          this.checkIdentifierUsage(call.callee as Identifier);
          this.checkArity(name, call);
          this.validateFunctionCallConstraints(name, call);
          this.validateTypeConstructorCallConstraints(name, call);
        } else {
          this.visitExpr(call.callee);
        }

        for (const arg of call.args) {
          this.visitExpr(arg);
        }
        return;
      }

      case 'MemberExpr': {
        const member = node as MemberExpr;
        this.visitMemberExpr(member);
        return;
      }

      case 'BinaryExpr': {
        const bin = node as any;
        this.visitExpr(bin.left);
        this.visitExpr(bin.right);
        return;
      }

      case 'UnaryExpr': {
        const unary = node as any;
        this.visitExpr(unary.operand);
        return;
      }

      case 'IndexExpr': {
        const index = node as any;
        this.visitExpr(index.object);
        this.visitExpr(index.index);
        return;
      }

      case 'FunctionExpr': {
        const fnExpr = node as any;
        this.withScope(() => {
          this.declareName('params');
          for (const param of fnExpr.params as Param[]) {
            this.declareName(param.name, this.extractTypeName(param.paramType), node);
          }
          this.visitExpr(fnExpr.body);
        });
        return;
      }

      case 'IfExpr': {
        const ifExpr = node as any;
        this.visitExpr(ifExpr.condition);
        this.visitExpr(ifExpr.thenBranch);
        this.visitExpr(ifExpr.elseBranch);
        return;
      }

      case 'MatchExpr': {
        this.visitMatchExpr(node as MatchExpr);
        return;
      }

      case 'RecordLiteral': {
        const record = node as any;
        for (const field of record.fields) {
          this.visitExpr(field.value);
        }
        return;
      }

      case 'ListLiteral': {
        const list = node as any;
        for (const element of list.elements) {
          this.visitExpr(element);
        }
        return;
      }

      case 'TupleLiteral': {
        const tuple = node as any;
        for (const element of tuple.elements) {
          this.visitExpr(element);
        }
        return;
      }

      case 'PipeExpr': {
        const pipe = node as any;
        this.visitExpr(pipe.left);
        this.visitExpr(pipe.right);
        return;
      }

      case 'BlockExpr': {
        const block = node as any;
        this.withScope(() => {
          for (const stmt of block.body as Node[]) {
            this.visitTopLevelNode(stmt);
          }
        });
        return;
      }

      case 'LetDecl': {
        const decl = node as LetDecl;
        this.visitExpr(decl.value);
        this.declarePattern(decl.pattern, this.inferTypeFromValue(decl.value), node);
        return;
      }

      case 'ForExpr': {
        const forExpr = node as any;
        this.visitExpr(forExpr.iterable);
        if (forExpr.condition) {
          this.visitExpr(forExpr.condition);
        }
        this.withScope(() => {
          this.declarePattern(forExpr.pattern, undefined, node);
          this.visitExpr(forExpr.body);
        });
        return;
      }

      case 'WhileExpr': {
        const whileExpr = node as any;
        this.visitExpr(whileExpr.condition);
        this.visitExpr(whileExpr.body);
        return;
      }

      case 'ListComprehension': {
        const comp = node as ListComprehension;
        this.visitExpr(comp.iterable);
        this.withScope(() => {
          this.declarePattern(comp.pattern, undefined, node);
          this.visitExpr(comp.element);
          if (comp.condition) {
            this.visitExpr(comp.condition);
          }
        });
        return;
      }

      case 'ReturnExpr': {
        const ret = node as any;
        this.visitExpr(ret.value);
        return;
      }

      case 'AwaitExpr': {
        const awaitExpr = node as any;
        this.visitExpr(awaitExpr.expression);
        return;
      }

      case 'StringInterpolation': {
        const interp = node as any;
        for (const part of interp.parts) {
          if (part.type === 'ExprPart') {
            this.visitExpr(part.expr);
          }
        }
        return;
      }

      default:
        return;
    }
  }

  private visitMemberExpr(member: MemberExpr): void {
    if (member.object.type === 'Identifier' && (member.object as Identifier).name === 'js') {
      return;
    }

    if (member.object.type === 'MemberExpr') {
      const nested = member.object as MemberExpr;
      if (this.isJsNamespaceChain(nested)) {
        return;
      }
    }

    this.visitExpr(member.object);
  }

  private isJsNamespaceChain(member: MemberExpr): boolean {
    if (member.object.type === 'Identifier' && (member.object as Identifier).name === 'js') {
      return true;
    }

    if (member.object.type === 'MemberExpr') {
      return this.isJsNamespaceChain(member.object as MemberExpr);
    }

    return false;
  }

  private visitMatchExpr(matchExpr: MatchExpr): void {
    this.visitExpr(matchExpr.value);

    const matchedType = this.inferTypeFromValue(matchExpr.value);
    const seenVariants = new Set<string>();
    const unguardedCoveredVariants = new Set<string>();
    let expectedBodyType: TypeTerm | undefined;
    let hasCatchAllUnguarded = false;
    let hasWildcard = false;

    for (const arm of matchExpr.arms) {
      if (hasCatchAllUnguarded) {
        this.addDiagnostic(
          'ARX4005',
          'Unreachable match arm: a previous wildcard arm already covers all remaining cases.',
          arm.body,
          'Remove this arm or move it before the wildcard arm.',
        );
      }

      const coveredVariants = this.getCoveredVariantsForPattern(arm.pattern, matchedType);
      if (!arm.guard && coveredVariants.length > 0 && coveredVariants.every(variant => unguardedCoveredVariants.has(variant))) {
        this.addDiagnostic(
          'ARX4005',
          'Unreachable match arm: this pattern is already covered by previous arms.',
          arm.body,
          'Remove this arm or place it before the broader pattern.',
        );
      }

      if (arm.pattern.type === 'WildcardPattern') {
        hasWildcard = true;
        if (!arm.guard) {
          hasCatchAllUnguarded = true;
        }
      }

      this.validateMatchPatternAgainstType(arm.pattern, matchedType, matchExpr);

      for (const variant of coveredVariants) {
        seenVariants.add(variant);
        if (!arm.guard) {
          unguardedCoveredVariants.add(variant);
        }
      }

      this.withScope(() => {
        this.declarePattern(arm.pattern, undefined, matchExpr);
        if (arm.guard) {
          this.visitExpr(arm.guard.condition);
          this.validateGuardCondition(arm.guard.condition);
        }
        this.visitExpr(arm.body);

        const armBodyType = this.inferTypeTermFromExpr(arm.body);
        if (!armBodyType) {
          return;
        }

        if (!expectedBodyType) {
          expectedBodyType = armBodyType;
          return;
        }

        if (!this.areTypeTermsEquivalent(expectedBodyType, armBodyType)) {
          this.addDiagnostic(
            'ARX4003',
            `Inconsistent match arm result types: expected '${this.typeTermToString(expectedBodyType)}', got '${this.typeTermToString(armBodyType)}'.`,
            arm.body,
            'Ensure all match arms produce compatible result types.',
          );
        }
      });
    }

    if (!matchedType || hasWildcard) {
      return;
    }

    const expectedVariants = this.adtVariants.get(matchedType);
    if (!expectedVariants || expectedVariants.size === 0) {
      return;
    }

    const missing = [...expectedVariants].filter(variant => !seenVariants.has(variant));
    if (missing.length > 0) {
      this.addDiagnostic(
        'ARX4001',
        `Non-exhaustive match for type '${matchedType}'. Missing cases: ${missing.join(', ')}.`,
        matchExpr,
        'Add the missing constructor patterns or add a wildcard arm (_).',
      );
    }
  }

  private getCoveredVariantsForPattern(pattern: Pattern, matchedType: string | undefined): string[] {
    if (pattern.type === 'ConstructorPattern') {
      return [pattern.name];
    }

    if (pattern.type === 'ListPattern') {
      const expectedVariants = matchedType ? this.adtVariants.get(matchedType) : undefined;
      if (!expectedVariants) {
        return [];
      }

      const hasListAdtShape = expectedVariants.has('Nil') && expectedVariants.has('Cons');
      if (!hasListAdtShape) {
        return [];
      }

      if (pattern.elements.length === 0 && !pattern.rest) {
        return ['Nil'];
      }

      return ['Cons'];
    }

    return [];
  }

  private validateMatchPatternAgainstType(pattern: Pattern, matchedType: string | undefined, ownerNode: Node): void {
    if (pattern.type === 'ConstructorPattern') {
      const ownerType = this.variantToType.get(pattern.name);
      if (!ownerType) {
        this.addDiagnostic(
          'ARX4002',
          `Unknown constructor pattern '${pattern.name}' in match arm.`,
          ownerNode,
          'Use a declared constructor name for this pattern.',
        );
        return;
      }

      if (matchedType && ownerType !== matchedType) {
        this.addDiagnostic(
          'ARX4002',
          `Constructor pattern '${pattern.name}' does not belong to matched type '${matchedType}'.`,
          ownerNode,
          'Use a constructor from the same ADT being matched.',
        );
      }

      const expectedArity = this.getConstructorArity(pattern.name);
      if (expectedArity !== undefined && expectedArity !== pattern.patterns.length) {
        this.addDiagnostic(
          'ARX4002',
          `Constructor pattern '${pattern.name}' expects ${expectedArity} argument pattern(s), got ${pattern.patterns.length}.`,
          ownerNode,
        );
      }
      return;
    }

    if (pattern.type === 'ListPattern' && matchedType) {
      const expectedVariants = this.adtVariants.get(matchedType);
      const hasListAdtShape = !!expectedVariants && expectedVariants.has('Nil') && expectedVariants.has('Cons');
      if (!hasListAdtShape) {
        this.addDiagnostic(
          'ARX4002',
          `List pattern cannot be used when matching type '${matchedType}'.`,
          ownerNode,
          'Use constructor patterns compatible with the matched ADT.',
        );
      }
    }
  }

  private getConstructorArity(constructorName: string): number | undefined {
    const ownerType = this.variantToType.get(constructorName);
    if (!ownerType) {
      return undefined;
    }

    const typeDecl = this.knownTypeDecls.get(ownerType);
    const variant = typeDecl?.variants.find(v => v.name === constructorName);
    return variant?.fields.length;
  }

  private areTypeTermsEquivalent(left: TypeTerm, right: TypeTerm): boolean {
    if (left.kind !== right.kind || left.name !== right.name || left.args.length !== right.args.length) {
      return false;
    }

    for (let i = 0; i < left.args.length; i++) {
      if (!this.areTypeTermsEquivalent(left.args[i], right.args[i])) {
        return false;
      }
    }

    return true;
  }

  private validateGuardCondition(condition: Node): void {
    const guardType = this.inferTypeTermFromExpr(condition);
    if (!guardType) {
      return;
    }

    if (guardType.kind === 'name' && guardType.name === 'Bool' && guardType.args.length === 0) {
      return;
    }

    this.addDiagnostic(
      'ARX4004',
      `Guard condition must evaluate to Bool, got '${this.typeTermToString(guardType)}'.`,
      condition,
      'Ensure the when clause expression has type Bool.',
    );
  }

  private validateTypeclassInstances(program: Program): void {
    for (const node of program.body) {
      if (node.type !== 'InstanceDecl') {
        continue;
      }

      const instanceDecl = node as InstanceDecl;
      const typeclass = this.knownTypeclasses.get(instanceDecl.typeclass);
      if (!typeclass) {
        this.addDiagnostic(
          'ARX2001',
          `Unknown typeclass '${instanceDecl.typeclass}' in instance declaration.`,
          node,
          'Declare or import the typeclass before using impl.',
        );
        continue;
      }

      this.validateInstanceConstraintsAgainstTypeclass(instanceDecl, typeclass, node);

      const declaredMethods = new Map<string, MethodDecl>();
      for (const method of typeclass.methods) {
        declaredMethods.set(method.name, method);
      }

      const implementedNames = new Set<string>();
      for (const method of instanceDecl.methods) {
        if (implementedNames.has(method.name)) {
          this.addDiagnostic(
            'ARX2005',
            `Duplicate implementation for method '${method.name}' in impl ${instanceDecl.typeclass}.`,
            node,
          );
          continue;
        }

        implementedNames.add(method.name);

        const declared = declaredMethods.get(method.name);
        if (!declared) {
          this.addDiagnostic(
            'ARX2002',
            `Method '${method.name}' is not declared in typeclass '${instanceDecl.typeclass}'.`,
            node,
            'Remove the method or declare it in the typeclass contract.',
          );
          continue;
        }

        if (method.params.length !== declared.params.length) {
          this.addDiagnostic(
            'ARX2004',
            `Method '${method.name}' in impl ${instanceDecl.typeclass} has arity ${method.params.length}, expected ${declared.params.length}.`,
            node,
          );
        }

        this.visitMethodImpl(method);
      }

      const requiredMethods = typeclass.methods.filter(method => !method.body).map(method => method.name);
      for (const required of requiredMethods) {
        if (!implementedNames.has(required)) {
          this.addDiagnostic(
            'ARX2003',
            `Missing required method '${required}' in impl ${instanceDecl.typeclass}.`,
            node,
            `Provide an implementation for ${required}(...) in this instance.`,
          );
        }
      }

    }
  }

  private visitTypeclassMethodBodies(typeclassDecl: TypeclassDecl): void {
    for (const method of typeclassDecl.methods) {
      if (!method.body) {
        continue;
      }

      this.visitMethodDecl(method);
    }
  }

  private visitMethodImpl(method: MethodImpl): void {
    this.withScope(() => {
      this.declareName('params');
      for (const param of method.params) {
        this.declareName(param);
      }
      this.visitExpr(method.body);
    });
  }

  private visitMethodDecl(method: MethodDecl): void {
    if (!method.body) {
      return;
    }

    this.withScope(() => {
      this.declareName('params');
      for (const param of method.params) {
        const typeName = this.extractTypeName(param.paramType);
        this.declareName(param.name, typeName);
      }
      this.visitExpr(method.body);
    });
  }

  private validateFunctionConstraints(fn: FunctionDecl): void {
    if (!fn.constraints || fn.constraints.length === 0) {
      return;
    }

    const paramTypes = new Map<string, TypeTerm | undefined>();
    const functionTypeVars = new Set<string>();

    for (const param of fn.params) {
      const typeTerm = this.typeTermFromNode(param.paramType);
      if (typeTerm) {
        this.collectTypeVars(typeTerm, functionTypeVars);
      }
      paramTypes.set(param.name, typeTerm);
    }

    for (const constraint of fn.constraints) {
      const typeclass = this.visitConstraint(constraint, fn);
      if (!typeclass) {
        continue;
      }

      const resolvedArgs: TypeTerm[] = [];
      let hasUnknownArg = false;

      for (const arg of constraint.args) {
        if (paramTypes.has(arg)) {
          const mapped = paramTypes.get(arg);
          if (mapped) {
            resolvedArgs.push(mapped);
          } else {
            hasUnknownArg = true;
          }
          continue;
        }

        if (functionTypeVars.has(arg)) {
          resolvedArgs.push({ kind: 'var', name: arg, args: [] });
          continue;
        }

        if (this.looksLikeConcreteTypeName(arg)) {
          resolvedArgs.push({ kind: 'name', name: arg, args: [] });
          continue;
        }

        hasUnknownArg = true;
        this.addDiagnostic(
          'ARX3007',
          `Unknown type reference '${arg}' in where constraint '${constraint.name}'.`,
          fn,
          'Use a function parameter name, a declared type parameter, or a concrete type name.',
        );
      }

      if (hasUnknownArg || resolvedArgs.length !== typeclass.typeParams.length) {
        continue;
      }

      if (this.isGroundConstraint(resolvedArgs) && !this.canSatisfyConstraint(constraint.name, resolvedArgs, [])) {
        this.addDiagnostic(
          'ARX3006',
          `Unsatisfied where constraint '${constraint.name}(${resolvedArgs.map(term => this.typeTermToString(term)).join(', ')})'.`,
          fn,
          'Declare or import an impl that satisfies this concrete constraint.',
        );
      }
    }
  }

  private validateTypeDeclConstraints(typeDecl: TypeDecl): void {
    if (!typeDecl.constraints || typeDecl.constraints.length === 0) {
      return;
    }

    const typeParams = new Set(typeDecl.typeParams ?? []);
    for (const constraint of typeDecl.constraints) {
      const resolved = this.visitConstraint(constraint, typeDecl);
      if (!resolved) {
        continue;
      }

      for (const arg of constraint.args) {
        if (!typeParams.has(arg) && !this.looksLikeConcreteTypeName(arg)) {
          this.addDiagnostic(
            'ARX3003',
            `Type constraint '${constraint.name}' references unknown type variable '${arg}'.`,
            typeDecl,
            'Declare the type variable in the type parameter list.',
          );
        }
      }
    }
  }

  private validateTypeclassDeclConstraints(typeclassDecl: TypeclassDecl): void {
    if (!typeclassDecl.constraints || typeclassDecl.constraints.length === 0) {
      return;
    }

    const typeParams = new Set(typeclassDecl.typeParams);
    for (const constraint of typeclassDecl.constraints) {
      const resolved = this.visitConstraint(constraint, typeclassDecl);
      if (!resolved) {
        continue;
      }

      for (const arg of constraint.args) {
        if (!typeParams.has(arg) && !this.looksLikeConcreteTypeName(arg)) {
          this.addDiagnostic(
            'ARX3003',
            `Typeclass constraint '${constraint.name}' references unknown type variable '${arg}'.`,
            typeclassDecl,
            'Declare the type variable in the typeclass parameter list.',
          );
        }
      }
    }
  }

  private validateInstanceDeclConstraints(instanceDecl: InstanceDecl): void {
    if (!instanceDecl.constraints || instanceDecl.constraints.length === 0) {
      return;
    }

    const boundTypeVars = new Set<string>();
    for (const forType of instanceDecl.forTypes) {
      const term = this.typeTermFromNode(forType);
      if (term) {
        this.collectTypeVars(term, boundTypeVars);
      }
    }

    for (const constraint of instanceDecl.constraints) {
      const typeclass = this.visitConstraint(constraint, instanceDecl);
      if (!typeclass) {
        continue;
      }

      const terms: TypeTerm[] = [];
      let hasUnknownArg = false;
      for (const arg of constraint.args) {
        const term = this.resolveConstraintArg(arg, boundTypeVars);
        if (!term) {
          hasUnknownArg = true;
          this.addDiagnostic(
            'ARX3004',
            `Instance constraint '${constraint.name}' uses unbound type variable '${arg}'.`,
            instanceDecl,
            'Bind this variable in the impl target type or replace it with a concrete type.',
          );
          continue;
        }
        terms.push(term);
      }

      if (hasUnknownArg || terms.length !== typeclass.typeParams.length) {
        continue;
      }

      if (this.isGroundConstraint(terms) && !this.canSatisfyConstraint(constraint.name, terms, [])) {
        this.addDiagnostic(
          'ARX3006',
          `Unsatisfied where constraint '${constraint.name}(${terms.map(term => this.typeTermToString(term)).join(', ')})'.`,
          instanceDecl,
          'Declare or import an impl that satisfies this concrete constraint.',
        );
      }
    }
  }

  private validateInstanceConstraintsAgainstTypeclass(instanceDecl: InstanceDecl, typeclass: TypeclassDecl, ownerNode: Node): void {
    if (instanceDecl.forTypes.length !== typeclass.typeParams.length) {
      this.addDiagnostic(
        'ARX2006',
        `impl ${instanceDecl.typeclass} expects ${typeclass.typeParams.length} type target(s), got ${instanceDecl.forTypes.length}.`,
        ownerNode,
      );
      return;
    }

    const substitution = new Map<string, TypeTerm>();
    for (let i = 0; i < typeclass.typeParams.length; i++) {
      const paramName = typeclass.typeParams[i];
      const instanceType = this.typeTermFromNode(instanceDecl.forTypes[i]);
      if (!instanceType) {
        return;
      }
      substitution.set(paramName, instanceType);
    }

    const instanceVarNames = new Set<string>();
    for (const term of substitution.values()) {
      this.collectTypeVars(term, instanceVarNames);
    }

    const givens: Array<{ typeclass: string; args: TypeTerm[] }> = [];
    for (const constraint of instanceDecl.constraints ?? []) {
      const resolved = this.constraintArgsToTerms(constraint, instanceVarNames);
      if (!resolved || resolved.length === 0) {
        continue;
      }
      givens.push({ typeclass: constraint.name, args: resolved });
    }

    for (const inheritedConstraint of typeclass.constraints ?? []) {
      const goalArgs: TypeTerm[] = [];
      for (const arg of inheritedConstraint.args) {
        if (substitution.has(arg)) {
          goalArgs.push(this.applySubstitution(substitution.get(arg)!, substitution));
          continue;
        }

        if (this.looksLikeConcreteTypeName(arg)) {
          goalArgs.push({ kind: 'name', name: arg, args: [] });
          continue;
        }

        this.addDiagnostic(
          'ARX3003',
          `Typeclass constraint '${inheritedConstraint.name}' references unknown type variable '${arg}'.`,
          ownerNode,
          'Fix the typeclass where clause to use declared type parameters.',
        );
      }

      if (goalArgs.length === 0) {
        continue;
      }

      if (!this.canSatisfyConstraint(inheritedConstraint.name, goalArgs, givens)) {
        this.addDiagnostic(
          'ARX3005',
          `impl ${instanceDecl.typeclass} for ${instanceDecl.forTypes.map(t => this.typeTermToString(this.typeTermFromNode(t) ?? { kind: 'name', name: '?', args: [] })).join(', ')} does not satisfy inherited constraint ${inheritedConstraint.name}(${goalArgs.map(arg => this.typeTermToString(arg)).join(', ')}).`,
          ownerNode,
          'Add a matching where constraint or declare/import the missing impl.',
        );
      }
    }
  }

  private validateFunctionCallConstraints(functionName: string, call: CallExpr): void {
    const fnDecl = this.knownFunctionDecls.get(functionName);
    if (!fnDecl) {
      return;
    }

    const paramTypeTerms = new Map<string, TypeTerm | undefined>();
    const declaredTypeVars = new Set<string>();
    for (const param of fnDecl.params) {
      const term = this.typeTermFromNode(param.paramType);
      if (term) {
        this.collectTypeVars(term, declaredTypeVars);
      }
      paramTypeTerms.set(param.name, term);
    }

    const inferredByParamName = new Map<string, TypeTerm>();
    const substitution = new Map<string, TypeTerm>();

    const limit = Math.min(fnDecl.params.length, call.args.length);
    for (let i = 0; i < limit; i++) {
      const param = fnDecl.params[i];
      const arg = call.args[i];
      const argType = this.inferTypeTermFromExpr(arg);
      if (!argType) {
        continue;
      }

      inferredByParamName.set(param.name, argType);

      const paramType = paramTypeTerms.get(param.name);
      if (!paramType) {
        continue;
      }

      const probeSubstitution = new Map(substitution);
      if (!this.unifyTerms(paramType, argType, probeSubstitution)) {
        const expectedType = this.applySubstitution(paramType, substitution);
        this.addDiagnostic(
          'ARX1008',
          `Call to '${functionName}' has incompatible type for argument '${param.name}': expected '${this.typeTermToString(expectedType)}', got '${this.typeTermToString(argType)}'.`,
          arg,
          'Pass a value with a type compatible with the function parameter annotation.',
        );
        continue;
      }

      substitution.clear();
      for (const [name, typeTerm] of probeSubstitution.entries()) {
        substitution.set(name, typeTerm);
      }
    }

    if (!fnDecl.constraints || fnDecl.constraints.length === 0) {
      return;
    }

    for (const constraint of fnDecl.constraints) {
      const typeclass = this.visitConstraint(constraint, call);
      if (!typeclass) {
        continue;
      }

      const resolvedArgs: TypeTerm[] = [];
      let hasUnknown = false;

      for (const argName of constraint.args) {
        if (inferredByParamName.has(argName)) {
          resolvedArgs.push(inferredByParamName.get(argName)!);
          continue;
        }

        if (declaredTypeVars.has(argName)) {
          const substituted = substitution.get(argName);
          if (substituted) {
            resolvedArgs.push(this.applySubstitution(substituted, substitution));
          } else {
            hasUnknown = true;
          }
          continue;
        }

        if (this.looksLikeConcreteTypeName(argName)) {
          resolvedArgs.push({ kind: 'name', name: argName, args: [] });
          continue;
        }

        hasUnknown = true;
      }

      if (hasUnknown || resolvedArgs.length !== typeclass.typeParams.length) {
        continue;
      }

      if (this.isGroundConstraint(resolvedArgs) && !this.canSatisfyConstraint(constraint.name, resolvedArgs, [])) {
        this.addDiagnostic(
          'ARX3006',
          `Call to '${functionName}' requires unsatisfied constraint ${constraint.name}(${resolvedArgs.map(arg => this.typeTermToString(arg)).join(', ')}).`,
          call,
          'Declare or import an impl that satisfies this constraint for the argument types.',
        );
      }
    }
  }

  private validateTypeConstructorCallConstraints(constructorName: string, call: CallExpr): void {
    const ownerTypeName = this.variantToType.get(constructorName);
    if (!ownerTypeName) {
      return;
    }

    const typeDecl = this.knownTypeDecls.get(ownerTypeName);
    if (!typeDecl || !typeDecl.constraints || typeDecl.constraints.length === 0) {
      return;
    }

    const variantDecl = typeDecl.variants.find(variant => variant.name === constructorName);
    if (!variantDecl || variantDecl.fields.length === 0) {
      return;
    }

    const substitution = new Map<string, TypeTerm>();
    const pairCount = Math.min(variantDecl.fields.length, call.args.length);
    for (let i = 0; i < pairCount; i++) {
      const fieldType = this.typeTermFromNode(variantDecl.fields[i].fieldType);
      const argType = this.inferTypeTermFromExpr(call.args[i]);
      if (!fieldType || !argType) {
        continue;
      }
      this.unifyTerms(fieldType, argType, substitution);
    }

    for (const constraint of typeDecl.constraints) {
      const typeclass = this.visitConstraint(constraint, call);
      if (!typeclass) {
        continue;
      }

      const resolvedArgs: TypeTerm[] = [];
      let hasUnknown = false;

      for (const argName of constraint.args) {
        const substituted = substitution.get(argName);
        if (substituted) {
          resolvedArgs.push(this.applySubstitution(substituted, substitution));
          continue;
        }

        if (this.looksLikeConcreteTypeName(argName)) {
          resolvedArgs.push({ kind: 'name', name: argName, args: [] });
          continue;
        }

        hasUnknown = true;
      }

      if (hasUnknown || resolvedArgs.length !== typeclass.typeParams.length) {
        continue;
      }

      if (this.isGroundConstraint(resolvedArgs) && !this.canSatisfyConstraint(constraint.name, resolvedArgs, [])) {
        this.addDiagnostic(
          'ARX3006',
          `Constructor '${constructorName}' requires unsatisfied constraint ${constraint.name}(${resolvedArgs.map(arg => this.typeTermToString(arg)).join(', ')}).`,
          call,
          'Declare or import an impl that satisfies this constraint for the constructor argument types.',
        );
      }
    }
  }

  private resolveConstraintArg(arg: string, boundTypeVars: Set<string>): TypeTerm | undefined {
    if (boundTypeVars.has(arg)) {
      return { kind: 'var', name: arg, args: [] };
    }

    if (this.looksLikeConcreteTypeName(arg)) {
      return { kind: 'name', name: arg, args: [] };
    }

    return undefined;
  }

  private constraintArgsToTerms(constraint: Constraint, boundTypeVars: Set<string>): TypeTerm[] | undefined {
    const args: TypeTerm[] = [];
    for (const arg of constraint.args) {
      const resolved = this.resolveConstraintArg(arg, boundTypeVars);
      if (!resolved) {
        return undefined;
      }
      args.push(resolved);
    }
    return args;
  }

  private canSatisfyConstraint(
    typeclassName: string,
    args: TypeTerm[],
    givens: Array<{ typeclass: string; args: TypeTerm[] }>,
    depth = 0,
    seen = new Set<string>(),
  ): boolean {
    if (depth > 20) {
      return false;
    }

    for (const given of givens) {
      if (given.typeclass !== typeclassName || given.args.length !== args.length) {
        continue;
      }

      const localSubst = new Map<string, TypeTerm>();
      let matches = true;
      for (let i = 0; i < args.length; i++) {
        if (!this.unifyTerms(given.args[i], args[i], localSubst)) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return true;
      }
    }

    const goalKey = `${typeclassName}(${args.map(arg => this.typeTermToString(arg)).join(',')})`;
    if (seen.has(goalKey)) {
      return false;
    }
    seen.add(goalKey);

    const rules = this.instanceRulesByTypeclass.get(typeclassName) ?? [];
    for (const rule of rules) {
      if (rule.headArgs.length !== args.length) {
        continue;
      }

      const substitution = new Map<string, TypeTerm>();
      let headMatches = true;
      for (let i = 0; i < args.length; i++) {
        if (!this.unifyTerms(rule.headArgs[i], args[i], substitution)) {
          headMatches = false;
          break;
        }
      }

      if (!headMatches) {
        continue;
      }

      let allConstraintsSatisfied = true;
      for (const constraint of rule.constraints) {
        const resolvedArgs = this.constraintArgsToTerms(constraint, rule.headVarNames);
        if (!resolvedArgs) {
          allConstraintsSatisfied = false;
          break;
        }

        const appliedArgs = resolvedArgs.map(arg => this.applySubstitution(arg, substitution));
        if (!this.canSatisfyConstraint(constraint.name, appliedArgs, givens, depth + 1, seen)) {
          allConstraintsSatisfied = false;
          break;
        }
      }

      if (allConstraintsSatisfied) {
        return true;
      }
    }

    return false;
  }

  private typeTermFromNode(typeNode: Node | undefined): TypeTerm | undefined {
    if (!typeNode) {
      return undefined;
    }

    if (typeNode.type === 'Identifier') {
      const name = (typeNode as Identifier).name;
      if (this.looksLikeTypeVariable(name)) {
        return { kind: 'var', name, args: [] };
      }
      return { kind: 'name', name, args: [] };
    }

    if (typeNode.type === 'CallExpr') {
      const call = typeNode as CallExpr;
      if (call.callee.type !== 'Identifier') {
        return undefined;
      }

      const calleeName = (call.callee as Identifier).name;
      const args: TypeTerm[] = [];
      for (const arg of call.args) {
        const converted = this.typeTermFromNode(arg);
        if (!converted) {
          return undefined;
        }
        args.push(converted);
      }

      return { kind: 'name', name: calleeName, args };
    }

    return undefined;
  }

  private inferTypeTermFromExpr(node: Node | undefined): TypeTerm | undefined {
    if (!node) {
      return undefined;
    }

    if (node.type === 'NumberLiteral') {
      const isFloat = (node as NumberLiteral).isFloat === true;
      return { kind: 'name', name: isFloat ? 'Float' : 'Int', args: [] };
    }
    if (node.type === 'StringLiteral') {
      return { kind: 'name', name: 'String', args: [] };
    }
    if (node.type === 'CharLiteral') {
      return { kind: 'name', name: 'Char', args: [] };
    }
    if (node.type === 'BooleanLiteral') {
      return { kind: 'name', name: 'Bool', args: [] };
    }

    if (node.type === 'Identifier') {
      const name = (node as Identifier).name;
      const lookedUp = this.lookupType(name);
      if (lookedUp) {
        return { kind: 'name', name: lookedUp, args: [] };
      }
      return undefined;
    }

    if (node.type === 'CallExpr') {
      const call = node as CallExpr;
      if (call.callee.type === 'Identifier') {
        const callee = (call.callee as Identifier).name;
        const adtType = this.variantToType.get(callee);
        if (adtType) {
          return { kind: 'name', name: adtType, args: [] };
        }
      }
      return undefined;
    }

    return undefined;
  }

  private looksLikeTypeVariable(name: string): boolean {
    return /^[a-z]/.test(name);
  }

  private looksLikeConcreteTypeName(name: string): boolean {
    return /^[A-Z]/.test(name);
  }

  private isGroundConstraint(args: TypeTerm[]): boolean {
    return args.every(arg => this.isGroundTypeTerm(arg));
  }

  private isGroundTypeTerm(term: TypeTerm): boolean {
    if (term.kind === 'var') {
      return false;
    }
    return term.args.every(arg => this.isGroundTypeTerm(arg));
  }

  private collectTypeVars(term: TypeTerm, out: Set<string>): void {
    if (term.kind === 'var') {
      out.add(term.name);
    }
    for (const arg of term.args) {
      this.collectTypeVars(arg, out);
    }
  }

  private applySubstitution(term: TypeTerm, substitution: Map<string, TypeTerm>): TypeTerm {
    if (term.kind === 'var') {
      const replacement = substitution.get(term.name);
      if (!replacement) {
        return term;
      }
      return this.applySubstitution(replacement, substitution);
    }

    if (term.args.length === 0) {
      return term;
    }

    return {
      kind: term.kind,
      name: term.name,
      args: term.args.map(arg => this.applySubstitution(arg, substitution)),
    };
  }

  private unifyTerms(left: TypeTerm, right: TypeTerm, substitution: Map<string, TypeTerm>): boolean {
    const resolvedLeft = this.applySubstitution(left, substitution);
    const resolvedRight = this.applySubstitution(right, substitution);

    if (resolvedLeft.kind === 'var') {
      substitution.set(resolvedLeft.name, resolvedRight);
      return true;
    }

    if (resolvedRight.kind === 'var') {
      substitution.set(resolvedRight.name, resolvedLeft);
      return true;
    }

    if (resolvedLeft.name !== resolvedRight.name || resolvedLeft.args.length !== resolvedRight.args.length) {
      return false;
    }

    for (let i = 0; i < resolvedLeft.args.length; i++) {
      if (!this.unifyTerms(resolvedLeft.args[i], resolvedRight.args[i], substitution)) {
        return false;
      }
    }

    return true;
  }

  private typeTermToString(term: TypeTerm): string {
    if (term.kind === 'var') {
      return term.name;
    }

    if (term.args.length === 0) {
      return term.name;
    }

    return `${term.name}(${term.args.map(arg => this.typeTermToString(arg)).join(', ')})`;
  }

  private checkIdentifierUsage(identifier: Identifier): void {
    const name = identifier.name;

    if (name === 'js') {
      this.addDiagnostic(
        'ARX1004',
        "The identifier 'js' is reserved for JavaScript interop and must be used as js.<name>.",
        identifier,
        "Use js.parseInt(...), js.Promise..., etc., and avoid declaring or referencing plain 'js'.",
      );
      return;
    }

    if (this.isNameDeclared(name) || this.importedNames.has(name) || this.knownFunctions.has(name) || this.knownConstructors.has(name) || this.knownTypeDecls.has(name) || this.knownTypeclasses.has(name) || this.adtVariants.has(name)) {
      return;
    }

    this.addDiagnostic(
      'ARX1001',
      `Identifier '${name}' is not defined in Arix scope.`,
      identifier,
      `Declare '${name}' or import it. For JavaScript interop use js.${name}.`,
    );
  }

  private checkArity(name: string, call: CallExpr): void {
    const expected = this.knownFunctions.get(name);
    if (expected === undefined) {
      return;
    }

    if (call.args.length > expected) {
      this.addDiagnostic(
        'ARX1002',
        `Function '${name}' expects at most ${expected} argument(s), got ${call.args.length}.`,
        call,
      );
    }
  }

  private inferTypeFromValue(node: Node | undefined): string | undefined {
    if (!node) {
      return undefined;
    }

    if (node.type === 'Identifier') {
      const name = (node as Identifier).name;
      if (this.adtVariants.has(name)) {
        return name;
      }

      if (this.variantToType.has(name)) {
        return this.variantToType.get(name);
      }

      return this.lookupType(name);
    }

    if (node.type === 'CallExpr') {
      const call = node as CallExpr;
      if (call.callee.type === 'Identifier') {
        const callee = (call.callee as Identifier).name;
        return this.variantToType.get(callee);
      }
    }

    return undefined;
  }

  private declarePattern(pattern: Pattern, inferredType: string | undefined, ownerNode?: Node): void {
    switch (pattern.type) {
      case 'IdentifierPattern': {
        const bindingName = pattern.as ?? pattern.name;
        this.declareName(bindingName, inferredType, ownerNode);
        return;
      }
      case 'RecordPattern': {
        for (const field of pattern.fields) {
          this.declarePattern(field.pattern, undefined, ownerNode);
          if (field.defaultValue) {
            this.visitExpr(field.defaultValue);
          }
        }
        if (pattern.rest) {
          this.declareName(pattern.rest, undefined, ownerNode);
        }
        return;
      }
      case 'TuplePattern': {
        for (const element of pattern.elements) {
          this.declarePattern(element, undefined, ownerNode);
        }
        return;
      }
      case 'ListPattern': {
        for (const element of pattern.elements) {
          this.declarePattern(element, undefined, ownerNode);
        }
        if (pattern.rest) {
          this.declareName(pattern.rest, undefined, ownerNode);
        }
        return;
      }
      case 'ConstructorPattern': {
        for (const child of pattern.patterns) {
          this.declarePattern(child, undefined, ownerNode);
        }
        return;
      }
      default:
        return;
    }
  }

  private extractTypeName(typeNode: Node | undefined): string | undefined {
    if (!typeNode) {
      return undefined;
    }

    if (typeNode.type === 'Identifier') {
      return (typeNode as Identifier).name;
    }

    if (typeNode.type === 'CallExpr') {
      const call = typeNode as CallExpr;
      if (call.callee.type === 'Identifier') {
        return (call.callee as Identifier).name;
      }
    }

    return undefined;
  }

  private withScope(run: () => void): void {
    this.scopes.push(new Set());
    this.typedScopes.push(new Map());
    try {
      run();
    } finally {
      this.scopes.pop();
      this.typedScopes.pop();
    }
  }

  private declareName(name: string, typeName?: string, node?: Node): void {
    this.assertNotReservedIdentifier(name, node, 'ARX1003');
    const scope = this.scopes[this.scopes.length - 1];
    scope.add(name);
    const typeTerm = this.typeTermFromDeclaredName(typeName);
    if (typeTerm) {
      const typedScope = this.typedScopes[this.typedScopes.length - 1];
      typedScope.set(name, typeTerm);
    }
  }

  private lookupType(name: string): string | undefined {
    return this.lookupTypeTerm(name)?.name;
  }

  private lookupTypeTerm(name: string): TypeTerm | undefined {
    for (let i = this.typedScopes.length - 1; i >= 0; i--) {
      const typeTerm = this.typedScopes[i].get(name);
      if (typeTerm) {
        return typeTerm;
      }
    }
    return undefined;
  }

  private typeTermFromDeclaredName(typeName: string | undefined): TypeTerm | undefined {
    if (!typeName) {
      return undefined;
    }

    if (this.looksLikeTypeVariable(typeName)) {
      return { kind: 'var', name: typeName, args: [] };
    }

    return { kind: 'name', name: typeName, args: [] };
  }

  private isNameDeclared(name: string): boolean {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) {
        return true;
      }
    }
    return false;
  }

  private assertNotReservedIdentifier(name: string, node: Node | undefined, code: string): void {
    if (name !== 'js') {
      return;
    }

    this.addDiagnostic(
      code,
      "'js' is a reserved namespace for JavaScript interop and cannot be declared or imported.",
      node,
    );
  }

  private sanitizeModuleName(moduleName: string): string {
    return moduleName.replace(/[-\s.]/g, '_');
  }

  private addDiagnostic(code: string, message: string, node?: Node, hint?: string): void {
    this.diagnostics.push(createDiagnostic(code, message, this.filePath, node, hint));
  }
}
