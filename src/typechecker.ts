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
  Node,
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
  monad: ['Monad', 'pureM', 'flatMap'],
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

export class TypeChecker {
  private readonly options: TypeCheckerOptions;
  private readonly diagnostics: CompilerDiagnostic[] = [];
  private readonly knownFunctions = new Map<string, number>();
  private readonly knownTypeclasses = new Map<string, TypeclassDecl>();
  private readonly knownConstructors = new Set<string>();
  private readonly adtVariants = new Map<string, Set<string>>();
  private readonly variantToType = new Map<string, string>();
  private readonly importedNames = new Set<string>();
  private readonly scopes: Set<string>[] = [new Set()];
  private readonly typedScopes: Map<string, string>[] = [new Map()];
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
    this.knownTypeclasses.clear();
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
      }

      if (node.type === 'TypeDecl') {
        const typeDecl = node as TypeDecl;
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
      case 'TypeclassDecl':
      case 'InstanceDecl':
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
          this.visitConstraint(constraint);
        }
      }

      this.visitExpr(fn.body);
    });
  }

  private visitConstraint(constraint: Constraint): void {
    if (!this.knownTypeclasses.has(constraint.name)) {
      this.addDiagnostic(
        'ARX3001',
        `Unknown typeclass '${constraint.name}' in where constraint.`,
        undefined,
        `Declare typeclass ${constraint.name}(...) or import the module that defines it.`,
      );
    }
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
    let hasWildcard = false;

    for (const arm of matchExpr.arms) {
      if (arm.pattern.type === 'WildcardPattern') {
        hasWildcard = true;
      }
      if (arm.pattern.type === 'ConstructorPattern') {
        seenVariants.add(arm.pattern.name);
      }

      this.withScope(() => {
        this.declarePattern(arm.pattern, undefined, matchExpr);
        if (arm.guard) {
          this.visitExpr(arm.guard.condition);
        }
        this.visitExpr(arm.body);
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

    if (this.isNameDeclared(name) || this.importedNames.has(name) || this.knownFunctions.has(name) || this.knownConstructors.has(name)) {
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
    if (typeName) {
      const typedScope = this.typedScopes[this.typedScopes.length - 1];
      typedScope.set(name, typeName);
    }
  }

  private lookupType(name: string): string | undefined {
    for (let i = this.typedScopes.length - 1; i >= 0; i--) {
      const typeName = this.typedScopes[i].get(name);
      if (typeName) {
        return typeName;
      }
    }
    return undefined;
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
