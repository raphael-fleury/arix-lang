import type {
  Node,
  Program,
  NumberLiteral,
  StringLiteral,
  CharLiteral,
  BooleanLiteral,
  NoneLiteral,
  Identifier,
  BinaryExpr,
  UnaryExpr,
  CallExpr,
  IndexExpr,
  MemberExpr,
  FunctionExpr,
  FunctionDecl,
  LetDecl,
  IfExpr,
  MatchExpr,
  MatchArm,
  RecordLiteral,
  ListLiteral,
  TupleLiteral,
  PipeExpr,
  BlockExpr,
  ReturnExpr,
  AwaitExpr,
  ImportStmt,
  TypeDecl,
  TypeAliasDecl,
  TypeclassDecl,
  InstanceDecl,
  MethodDecl,
  Param,
  Pattern,
  ForExpr,
  WhileExpr,
  BreakExpr,
  ContinueExpr,
  Decorator,
  ListComprehension,
  StringInterpolation,
} from './ast.js';

// Runtime import will be generated dynamically based on output location
const RUNTIME_IMPORT = (relativePath: string) => 
  `import { createADT } from '${relativePath}';`;

const STDLIB_MODULES = ['bool', 'eq', 'num', 'ord', 'result', 'maybe', 'list', 'show', 'functor', 'applicative', 'monad', 'monoid', 'prelude'];
const JS_NAMESPACE = 'js';
const RUNTIME_NAMESPACE = 'runtime';
interface GlobalInstanceInfo {
  typeclass: string;
  forTypes: string[];
  methods: string[];
  module: string;
}

export class Transpiler {
  private output = '';
  private indent = 0;
  private inAsync = false;
  private constructors: Map<string, string> = new Map();
  private importsUsed: Set<string> = new Set();
  private typeclasses: Map<string, TypeclassDecl> = new Map();
  private globalTypeclasses: Map<string, TypeclassDecl> = new Map();
  private instances: Map<string, InstanceDecl[]> = new Map();
  private instanceIds: Map<string, string[]> = new Map(); // Maps typeclass name to array of instance variable names
  private instanceTypes: Map<string, string[]> = new Map(); // Maps instance var name to its type checks
  private functions: Map<string, number> = new Map();
  private exports: string[] = [];
  private esmImports: string[] = [];
  private currentFilePath: string = '';
  private importedNames: Map<string, string> = new Map();
  private moduleInfoMap: Map<string, { exports: string[]; imports: string[] }> = new Map();
  private moduleNamespaces: Map<string, string> = new Map();
  private runtimeImports: Set<string> = new Set(); // Track what to import from runtime
  private outputDir: string = '';
  private autoRunMain = false;
  private variantFieldNames: Map<string, string[]> = new Map();
  private instanceCounter = 0;
  private globalInstances: GlobalInstanceInfo[] = [];
  private needsBoolHelpers = false;
  private needsDecoratorHelpers = false;
  private scopeStack: Set<string>[] = [];
  private operatorFns: Map<string, string> = new Map(); // symbol → fn name
  private nativePrimitives = false;

  setOutputDir(dir: string): void {
    this.outputDir = dir;
  }

  setAutoRunMain(auto: boolean): void {
    this.autoRunMain = auto;
  }

  setOperatorFns(ops: Map<string, string>): void {
    for (const [sym, fn] of ops) {
      this.operatorFns.set(sym, fn);
    }
  }

  setNativePrimitives(enabled: boolean): void {
    this.nativePrimitives = enabled;
  }

  transpile(ast: Program, filePath: string = ''): string {
    this.output = '';
    this.indent = 0;
    this.importsUsed.clear();
    this.functions.clear();
    this.exports = [];
    this.esmImports = [];
    this.importedNames.clear();
    this.instances.clear();
    this.instanceIds.clear();
    this.instanceTypes.clear();
    this.moduleNamespaces.clear();
    this.instanceCounter = 0;
    this.currentFilePath = filePath;
    this.runtimeImports.clear();
    this.needsBoolHelpers = false;
    this.needsDecoratorHelpers = false;
    // NOTE: Don't reset operatorFns here - it's set by setOperatorFns() and should be preserved
    this.scopeStack = [new Set()];

    if (this.nativePrimitives) {
      this.runtimeImports.add('__arixInt');
      this.runtimeImports.add('__arixFloat');
      this.runtimeImports.add('__arixIsInt');
      this.runtimeImports.add('__arixIsFloat');
    }

    const explicitImports = ast.body.filter((node): node is ImportStmt => node.type === 'ImportStmt');
    const implicitStdlibImports = this.getImplicitStdlibImports(explicitImports);

    // Merge global typeclasses with local ones (local takes precedence)
    this.typeclasses = new Map(this.globalTypeclasses);

    // Pre-register top-level function signatures so dispatch generation can avoid name clashes.
    for (const node of ast.body) {
      if (node.type === 'FunctionDecl') {
        const fn = node as FunctionDecl;
        this.functions.set(fn.name, fn.params.length);
      }
      if (node.type === 'ImportStmt') {
        this.registerImportNamespace(node as ImportStmt);
      }
    }

    for (const importNode of implicitStdlibImports) {
      this.registerImportNamespace(importNode);
    }

    // Pre-register imports so typeclass/instance bodies can resolve imported symbols
    // before the regular import emission pass.
    for (const importNode of implicitStdlibImports) {
      this.transpileImportStmt(importNode);
    }
    for (const node of ast.body) {
      if (node.type === 'ImportStmt') {
        this.transpileImportStmt(node as ImportStmt);
      }
    }

    // First pass: register all typeclasses and instances for default implementations
    let firstPassInstanceCounter = 0;
    for (const node of ast.body) {
      if (node.type === 'TypeDecl') {
        const typeDecl = node as TypeDecl;
        for (const variant of typeDecl.variants) {
          const fieldNames = variant.fields.map(f => f.name);
          this.constructors.set(variant.name, `${typeDecl.name}.${variant.name}`);
          this.variantFieldNames.set(variant.name, fieldNames);
        }
      }
      if (node.type === 'TypeclassDecl') {
        const tc = node as TypeclassDecl;
        this.typeclasses.set(tc.name, tc);
      }
      if (node.type === 'InstanceDecl') {
        const inst = node as InstanceDecl;
        if (!this.instances.has(inst.typeclass)) {
          this.instances.set(inst.typeclass, []);
        }
        this.instances.get(inst.typeclass)!.push(inst);
        
        // Also track instance variable names and types for dispatch generation
        if (!this.instanceIds.has(inst.typeclass)) {
          this.instanceIds.set(inst.typeclass, []);
        }
        const instanceVarName = `__instance_${inst.typeclass}_${firstPassInstanceCounter}`;
        this.instanceIds.get(inst.typeclass)!.push(instanceVarName);
        const typeNames = inst.forTypes.map(t => this.getTypeName(t));
        this.instanceTypes.set(instanceVarName, typeNames);
        firstPassInstanceCounter++;
      }
    }

    this.writeln('// Generated by Arix');
    this.writeln('');
    this.emitListHelpers();

    // First: transpile typeclasses only
    for (const node of ast.body) {
      if (node.type === 'TypeclassDecl') {
        this.transpileNode(node);
      }
    }

    // Second: generate dispatch functions (before instances, so instances can use them)
    this.generateDispatchFunctions();

    // Third: transpile instances
    for (const node of ast.body) {
      if (node.type === 'InstanceDecl') {
        this.transpileNode(node);
      }
    }

    // Fourth: transpile everything else
    for (const importNode of implicitStdlibImports) {
      this.transpileImportStmt(importNode);
    }

    for (const node of ast.body) {
      if (node.type !== 'TypeclassDecl' && node.type !== 'InstanceDecl') {
        this.transpileNode(node);
      }
    }

    // Add inline Bool helpers when Bool semantics are used.
    if (this.needsBoolHelpers) {
      const boolHelpers = [
        'const __boolIs = (v) => v && v._type === \'Bool\' && (v._variant === \'True\' || v._variant === \'False\');',
        'const __boolTrue = () => ({ _type: \'Bool\', _variant: \'True\', _values: [] });',
        'const __boolFalse = () => ({ _type: \'Bool\', _variant: \'False\', _values: [] });',
        'const __boolFromJs = (v) => (v ? __boolTrue() : __boolFalse());',
        'const __boolToJs = (v) => __boolIs(v) ? v._variant === \'True\' : (typeof v === \'boolean\' ? v : Boolean(v));',
        'const __boolNot = (v) => __boolFromJs(!__boolToJs(v));',
        'const __valueEq = (a, b) => __boolFromJs((__boolIs(a) || __boolIs(b)) ? (__boolToJs(a) === __boolToJs(b)) : (a === b));',
        'const __valueNe = (a, b) => __boolFromJs((__boolIs(a) || __boolIs(b)) ? (__boolToJs(a) !== __boolToJs(b)) : (a !== b));',
        ''
      ].join('\n');
      this.output = boolHelpers + this.output;
    }

    if (this.needsDecoratorHelpers) {
      const decoratorHelpers = [
        'const __arixMemoize = (fn) => {',
        '  const cache = new Map();',
        '  return function(...args) {',
        '    const key = JSON.stringify(args);',
        '    if (cache.has(key)) return cache.get(key);',
        '    const result = fn.apply(this, args);',
        '    cache.set(key, result);',
        '    return result;',
        '  };',
        '};',
        'const __arixDeprecated = (fn, message) => function(...args) {',
        '  console.warn(`Deprecated function call${message ? `: ${message}` : ""}`);',
        '  return fn.apply(this, args);',
        '};',
        'const __applyArixDecorators = (fn, decorators) => {',
        '  let decorated = fn;',
        '  for (let i = decorators.length - 1; i >= 0; i--) {',
        '    const dec = decorators[i] || {};',
        '    const kind = typeof dec.name === "string" ? dec.name.toLowerCase() : "";',
        '    if (kind === "memo") {',
        '      decorated = __arixMemoize(decorated);',
        '      continue;',
        '    }',
        '    if (kind === "deprecated") {',
        '      decorated = __arixDeprecated(decorated, dec.args && dec.args.length > 0 ? dec.args[0] : undefined);',
        '      continue;',
        '    }',
        '    if (kind === "inline") {',
        '      continue;',
        '    }',
        '  }',
        '  decorated._decorators = decorators;',
        '  return decorated;',
        '};',
        ''
      ].join('\n');
      this.output = decoratorHelpers + this.output;
    }

    // Add ESM imports at the top (including runtime import if needed)
    let topImports: string[] = [];
    
    if (this.runtimeImports.size > 0) {
      const runtimeItems = Array.from(this.runtimeImports).sort();
      topImports.push(`import { ${runtimeItems.join(', ')} } from './arix-runtime.js';`);
    }
    
    topImports.push(...this.esmImports);
    
    if (topImports.length > 0) {
      this.output = topImports.join('\n') + '\n\n' + this.output;
    }

    // Add exports at the bottom for functions/types
    if (this.exports.length > 0) {
      this.output = this.output.trimEnd() + '\n\nexport { ' + this.exports.join(', ') + ' };\n';
    }

    // Add auto-run main() if enabled (must be after exports)
    // Auto-run if: autoRunMain is true AND main is either exported OR just exists
    if (this.autoRunMain && (this.exports.includes('main') || this.functions.has('main'))) {
      this.output = this.output.trimEnd() + '\n\nif (typeof window === "undefined" && typeof process !== "undefined") {\n  main();\n}\n';
    }

    return this.output;
  }

  getImports(): string[] {
    return Array.from(this.importsUsed);
  }

  getExports(): string[] {
    return this.exports;
  }

  setModuleInfo(map: Map<string, { exports: string[]; imports: string[] }>): void {
    this.moduleInfoMap = map;
  }

  setGlobalTypeclasses(typeclasses: Map<string, TypeclassDecl>): void {
    this.globalTypeclasses = typeclasses;
  }

  setGlobalInstances(instances: GlobalInstanceInfo[]): void {
    this.globalInstances = instances;
  }

  private writeln(text = ''): void {
    if (text === '') {
      this.output += '\n';
    } else {
      this.output += '  '.repeat(this.indent) + text + '\n';
    }
  }

  private transpileNode(node: Node): void {
    switch (node.type) {
      case 'FunctionDecl':
        this.transpileFunctionDecl(node as FunctionDecl);
        break;
      case 'LetDecl':
        this.transpileLetDecl(node as LetDecl);
        break;
      case 'TypeDecl':
        this.transpileTypeDecl(node as TypeDecl);
        break;
      case 'TypeAliasDecl':
        this.transpileTypeAliasDecl(node as TypeAliasDecl);
        break;
      case 'TypeclassDecl':
        this.transpileTypeclassDecl(node as TypeclassDecl);
        break;
      case 'InstanceDecl':
        this.transpileInstanceDecl(node as InstanceDecl);
        break;
      case 'ImportStmt':
        this.transpileImportStmt(node as ImportStmt);
        break;
      case 'CallExpr':
      case 'PipeExpr':
      case 'BinaryExpr':
      case 'MemberExpr':
      case 'IndexExpr':
      case 'UnaryExpr':
      case 'MatchExpr':
        this.writeln(this.transpileExpr(node) + ';');
        break;
      default:
        this.transpileExpr(node);
        this.writeln(';');
    }
  }

  private transpileFunctionDecl(node: FunctionDecl): void {
    this.assertNotReservedIdentifier(node.name);
    this.functions.set(node.name, node.params.length);

    // Register @Operator decorator at compile time (symbol → fnName)
    const operatorDec = node.decorators?.find(d => d.name === 'Operator');
    if (operatorDec && operatorDec.args.length >= 1) {
      const symNode = operatorDec.args[0];
      if (symNode.type === 'StringLiteral') {
        this.operatorFns.set((symNode as any).value as string, node.name);
      }
    }

    // Filter out @Operator before passing to __applyArixDecorators (it's compile-time only)
    const runtimeDecorators = (node.decorators || []).filter(d => d.name !== 'Operator');

    const asyncPrefix = node.isAsync ? 'async ' : '';
    const visibility = node.visibility === 'public' ? 'export ' : '';
    
    // Check if it's an operator function (body is arrow function)
    if (node.body.type === 'FunctionExpr') {
      // It's an operator function like: fn add = (+)
      const fnExpr = node.body as FunctionExpr;
      fnExpr.params.forEach(param => this.assertNotReservedIdentifier(param.name));
      const body = this.withScope(() => {
        this.declareName(node.name);
        fnExpr.params.forEach(param => this.declareName(param.name));
        return this.transpileExpr(fnExpr.body);
      });
      const params = fnExpr.params.map(p => p.name).join(', ');
      if (runtimeDecorators.length > 0) {
        this.writeln(`${visibility}function ${node.name}(${params}) {`);
        this.indent++;
        this.writeln(`return ${body};`);
        this.indent--;
        this.writeln('}');
      } else {
        this.writeln(`${visibility}const ${node.name} = (${params}) => ${body};`);
      }
    } else if (node.params.length === 0) {
      this.writeln(`${visibility}${asyncPrefix}function ${node.name}() {`);
      this.indent++;
      this.pushScope();
      this.declareName(node.name);
      this.emitImplicitArgAliases(node.params);
      
      if (node.body.type === 'BlockExpr') {
        const block = node.body as BlockExpr;
        const statements = block.body.slice(0, -1);
        const last = block.body[block.body.length - 1];
        for (const stmt of statements) {
          this.transpileNode(stmt);
        }
        if (last) {
          const lastExpr = this.transpileExpr(last);
          this.writeln(`return ${lastExpr};`);
        }
      } else {
        const body = this.transpileExpr(node.body);
        this.writeln(`return ${body};`);
      }
      
      this.popScope();
      this.indent--;
      this.writeln('}');
    } else {
      node.params.forEach(param => this.assertNotReservedIdentifier(param.name));
      const params = node.params.map(p => p.name).join(', ');
      this.writeln(`${visibility}${asyncPrefix}function ${node.name}(${params}) {`);
      this.indent++;
      this.pushScope();
      this.declareName(node.name);
      node.params.forEach(param => this.declareName(param.name));
      this.emitImplicitArgAliases(node.params);
      
      if (node.body.type === 'BlockExpr') {
        const block = node.body as BlockExpr;
        const statements = block.body.slice(0, -1);
        const last = block.body[block.body.length - 1];
        for (const stmt of statements) {
          this.transpileNode(stmt);
        }
        if (last) {
          const lastExpr = this.transpileExpr(last);
          this.writeln(`return ${lastExpr};`);
        }
      } else {
        const body = this.transpileExpr(node.body);
        this.writeln(`return ${body};`);
      }
      
      this.popScope();
      this.indent--;
      this.writeln('}');
    }

    if (runtimeDecorators.length > 0) {
      this.needsDecoratorHelpers = true;
      this.writeln(`${node.name} = __applyArixDecorators(${node.name}, ${this.transpileDecorators(runtimeDecorators)});`);
    }

    this.writeln();
  }

  private transpileDecorators(decorators: Decorator[]): string {
    const entries = decorators.map(dec => {
      const args = dec.args.map(arg => this.transpileExpr(arg)).join(', ');
      return `{ name: ${JSON.stringify(dec.name)}, args: [${args}] }`;
    });
    return `[${entries.join(', ')}]`;
  }

  private transpileLetDecl(node: LetDecl): void {
    if (node.pattern.type === 'ListPattern') {
      const value = this.transpileExpr(node.value);
      const tempValue = `__list_value_${this.instanceCounter++}`;
      this.writeln(`const ${tempValue} = ${value};`);
      const { condition, bindings, refs } = this.transpileListPatternMatch(node.pattern, tempValue);
      const checks = condition || 'true';
      this.writeln(`if (!(${checks})) { throw new Error('List pattern match failed'); }`);
      const allBindings = [refs, bindings].filter(Boolean).join('; ');
      if (allBindings) {
        this.writeln(`${allBindings};`);
      }
      this.collectPatternBindings(node.pattern).forEach(name => this.declareName(name));
      return;
    }

    const keyword = node.isMutable ? 'let' : 'const';
    const pattern = this.transpileLetPattern(node.pattern);
    const value = this.transpileExpr(node.value);
    this.writeln(`${keyword} ${pattern} = ${value};`);
    this.collectPatternBindings(node.pattern).forEach(name => this.declareName(name));
  }

  private transpileLetPattern(pattern: Pattern): string {
    switch (pattern.type) {
      case 'WildcardPattern':
        return '_';
      case 'IdentifierPattern':
        return pattern.as || pattern.name;
      case 'LiteralPattern':
        return this.transpileExpr(pattern.literal);
      case 'RecordPattern':
        return `{ ${pattern.fields.map(f => {
          const varName = f.pattern.type === 'IdentifierPattern' 
            ? (f.pattern as any).as || f.pattern.name 
            : this.transpileLetPattern(f.pattern);
          const defaultPart = f.defaultValue ? ` ?? ${this.transpileExpr(f.defaultValue)}` : '';
          return `${f.key}: ${varName}${defaultPart}`;
        }).join(', ')} }`;
      case 'TuplePattern':
        return `[${pattern.elements.map(e => this.transpileLetPattern(e)).join(', ')}]`;
      case 'ListPattern': {
        return '_';
      }
      case 'ConstructorPattern':
        const args = pattern.patterns.map(p => this.transpileLetPattern(p)).join(', ');
        return `${pattern.name}(${args})`;
      default:
        return '_';
    }
  }

  private transpilePattern(pattern: Pattern): string {
    switch (pattern.type) {
      case 'WildcardPattern':
        return '_';
      case 'IdentifierPattern':
        return pattern.as || pattern.name;
      case 'LiteralPattern':
        return this.transpileExpr(pattern.literal);
      case 'RecordPattern':
        return `{ ${pattern.fields.map(f => {
          const value = this.transpilePattern(f.pattern);
          return `${f.key}: ${value}`;
        }).join(', ')} }`;
      case 'TuplePattern':
        return `[${pattern.elements.map(e => this.transpilePattern(e)).join(', ')}]`;
      case 'ListPattern':
        return `[${pattern.elements.map(e => this.transpilePattern(e)).join(', ')}]`;
      case 'ConstructorPattern':
        const args = pattern.patterns.map(p => this.transpilePattern(p)).join(', ');
        return `${pattern.name}(${args})`;
      default:
        return '_';
    }
  }

  private transpileTypeDecl(node: TypeDecl): void {
    this.declareName(node.name);
    this.exports.push(node.name);
    
    if (node.recordFields) {
      const fields = node.recordFields.map(f => {
        const defaultPart = f.default ? ` = ${this.transpileExpr(f.default)}` : '';
        return `${f.name}: ${this.transpileType(f.fieldType)}${defaultPart}`;
      }).join(', ');
      this.writeln(`const ${node.name} = { ${fields} };`);
    } else {
      this.runtimeImports.add('createADT');
      
      const variants: Record<string, string[]> = {};
      for (const variant of node.variants) {
        const fieldNames = variant.fields.map(f => f.name);
        variants[variant.name] = fieldNames;
        this.constructors.set(variant.name, `${node.name}.${variant.name}`);
        this.variantFieldNames.set(variant.name, fieldNames);
        this.exports.push(variant.name);
      }
      
      const variantsStr = JSON.stringify(variants)
        .replace(/"/g, "'")
        .replace(/'([^']+)':/g, '$1:');
      
      this.writeln(`const ${node.name} = createADT('${node.name}', ${variantsStr});`);
      
      for (const variant of node.variants) {
        this.writeln(`const ${variant.name} = ${node.name}.${variant.name};`);
      }
    }
    this.writeln();
  }

  private transpileTypeAliasDecl(_node: TypeAliasDecl): void {
    // Type aliases are compile-time only and emit no JS runtime code.
  }

  private transpileType(node: Node): string {
    if (node.type === 'Identifier') {
      return (node as Identifier).name;
    }
    if (node.type === 'CallExpr') {
      const call = node as CallExpr;
      const args = call.args.map(a => this.transpileType(a)).join(', ');
      return `${this.transpileExpr(call.callee)}<${args}>`;
    }
    return 'any';
  }

  private transpileImportStmt(node: ImportStmt): void {
    const moduleNameLower = node.module.toLowerCase();
    const namespace = this.getImportNamespace(node);

    if (STDLIB_MODULES.includes(moduleNameLower)) {
      const jsPath = `./${moduleNameLower}.js`;
      const moduleInfo = this.moduleInfoMap.get(node.module);

      if (node.implicit) {
        this.pushEsmImport(`import * as ${namespace} from '${jsPath}';`);
        const exportItems = (moduleInfo?.exports || this.getStdlibFallbackExports(moduleNameLower)).filter(item => !this.isGeneratedDispatchMethod(item));
        for (const item of exportItems) {
          if (!this.importedNames.has(item)) {
            this.importedNames.set(item, namespace);
          }
        }
        return;
      }

      if (node.alias) {
        this.assertNotReservedIdentifier(namespace);
        this.pushEsmImport(`import * as ${namespace} from '${jsPath}';`);
        this.importedNames.set(namespace, namespace);
        this.constructors.set(namespace, namespace);
        return;
      }

      // Keep a namespace import available for cross-module typeclass dispatch.
      this.pushEsmImport(`import * as ${namespace} from '${jsPath}';`);

      let importItems = moduleInfo?.exports ? [...moduleInfo.exports] : [...this.getStdlibFallbackExports(moduleNameLower)];

      if (node.items && node.items.length > 0) {
        importItems = [...node.items];
      }

      if (node.hiding && node.hiding.length > 0) {
        importItems = importItems.filter(item => !node.hiding!.includes(item));
      }

      importItems = importItems.filter(item => !this.isGeneratedDispatchMethod(item));

      if (importItems.length > 0) {
        importItems.forEach(item => this.assertNotReservedIdentifier(item));
        const itemsStr = importItems.join(', ');
        this.pushEsmImport(`import { ${itemsStr} } from '${jsPath}';`);
        for (const item of importItems) {
          this.importedNames.set(item, '');
          this.constructors.set(item, item);
        }
      } else {
        this.pushEsmImport(`import * as ${namespace} from '${jsPath}';`);
      }
      return;
    }

    const jsPath = this.moduleToJsPath(node.module, node.isRelative);
    
    const moduleName = this.getModuleName(node.module);
    const sanitizedAlias = this.sanitizeModuleName(node.alias || moduleName);
    
    // Register the module namespace for cross-module typeclass dispatch
    this.moduleNamespaces.set(node.module, sanitizedAlias);
    
    if (node.items && node.items.length > 0) {
      node.items.forEach(item => this.assertNotReservedIdentifier(item));
      const itemsStr = node.items.join(', ');
      this.pushEsmImport(`import { ${itemsStr} } from '${jsPath}';`);
      for (const item of node.items) {
        this.importedNames.set(item, '');
        this.constructors.set(item, item);
      }
    } else if (node.alias) {
      this.assertNotReservedIdentifier(sanitizedAlias);
      this.pushEsmImport(`import * as ${sanitizedAlias} from '${jsPath}';`);
      this.importedNames.set(sanitizedAlias, sanitizedAlias);
      this.constructors.set(sanitizedAlias, sanitizedAlias);
    } else {
      this.pushEsmImport(`import * as ${sanitizedAlias} from '${jsPath}';`);
      
      const moduleKey = node.isRelative ? node.module : this.getModuleName(node.module);
      const moduleInfo = this.moduleInfoMap.get(node.module) || this.moduleInfoMap.get(moduleKey);
      
      if (moduleInfo) {
        for (const exportedName of moduleInfo.exports) {
          // Don't override locally defined dispatch functions
          if (!this.importedNames.has(exportedName)) {
            this.importedNames.set(exportedName, sanitizedAlias);
          }
        }
      }
    }
  }

  private registerImportNamespace(node: ImportStmt): void {
    const moduleNameLower = node.module.toLowerCase();
    const isStdlibModule = STDLIB_MODULES.includes(moduleNameLower);
    if (!isStdlibModule) {
      return;
    }

    const namespace = node.alias
      ? this.sanitizeModuleName(node.alias)
      : `__mod_${this.sanitizeModuleName(moduleNameLower)}`;
    this.moduleNamespaces.set(moduleNameLower, namespace);
    this.moduleNamespaces.set(node.module, namespace);
  }

  private getImportNamespace(node: ImportStmt): string {
    const moduleNameLower = node.module.toLowerCase();
    const existing = this.moduleNamespaces.get(node.module) || this.moduleNamespaces.get(moduleNameLower);
    if (existing) {
      return existing;
    }
    const fallback = node.alias
      ? this.sanitizeModuleName(node.alias)
      : `__mod_${this.sanitizeModuleName(moduleNameLower)}`;
    this.moduleNamespaces.set(moduleNameLower, fallback);
    this.moduleNamespaces.set(node.module, fallback);
    return fallback;
  }

  private pushEsmImport(importLine: string): void {
    if (!this.esmImports.includes(importLine)) {
      this.esmImports.push(importLine);
    }
  }

  private getImplicitStdlibImports(explicitImports: ImportStmt[]): ImportStmt[] {
    if (!this.currentFilePath || this.isStdlibSourceFile(this.currentFilePath)) {
      return [];
    }

    const explicitStdlibModules = new Set(
      explicitImports
        .map(imp => imp.module.toLowerCase())
        .filter(moduleName => STDLIB_MODULES.includes(moduleName))
    );

    return STDLIB_MODULES
      .filter(moduleName => !explicitStdlibModules.has(moduleName))
      .map(moduleName => ({
        type: 'ImportStmt',
        module: moduleName,
        isRelative: false,
        implicit: true,
      }));
  }

  private isStdlibSourceFile(filePath: string): boolean {
    return /[\\/]stdlib[\\/]/.test(filePath);
  }

  private getModuleName(modulePath: string): string {
    const parts = modulePath.split('/');
    return parts[parts.length - 1];
  }

  private sanitizeModuleName(moduleName: string): string {
    // Replace hyphens, slashes, dots, and other non-identifier characters with underscores
    return moduleName.replace(/[-\s./\\]/g, '_');
  }

  private moduleToJsPath(module: string, isRelative: boolean): string {
    if (isRelative) {
      // Relative import: ./foo-bar or ../foo-bar (module already includes ./ or ../)
      return `${module}.js`;
    } else {
      // Local import: foo-bar -> ./foo-bar.js
      return `./${module}.js`;
    }
  }

  private transpileExpr(node: Node): string {
    if (!node) {
      console.error('Error: transpileExpr called with undefined node');
      throw new Error('transpileExpr called with undefined node');
    }
    switch (node.type) {
      case 'NumberLiteral':
        if (this.nativePrimitives) {
          const numNode = node as NumberLiteral;
          const isFloat = numNode.isFloat === true;
          const value = String(numNode.value);
          return isFloat ? `__arixFloat(${value})` : `__arixInt(${value})`;
        }
        return String((node as NumberLiteral).value);
      
      case 'StringLiteral':
        const str = (node as StringLiteral).value.replace(/"/g, '\\"');
        return `"${str}"`;

      case 'CharLiteral':
        const charVal = (node as any).value;
        return `"${charVal.replace(/"/g, '\\"')}"`;
      
      case 'BooleanLiteral':
        this.needsBoolHelpers = true;
        return (node as BooleanLiteral).value ? '__boolTrue()' : '__boolFalse()';
      
      case 'NoneLiteral':
        return 'null';
      
      case 'Identifier': {
        const name = (node as Identifier).name;
        return this.resolveIdentifierReference(name, true);
      }
      
      case 'BinaryExpr': {
        const bin = node as BinaryExpr;
        const left = this.transpileExpr(bin.left);
        const right = this.transpileExpr(bin.right);

        if (bin.operator === '=') {
          return `${left} = ${right}`;
        }

        const customFn = this.operatorFns.get(bin.operator);

        // Custom operator declared via @Operator — dispatch to its function
        if (customFn) {
          return `${customFn}(${left}, ${right})`;
        }

        this.throwUndefinedOperatorError(bin.operator, bin, 'binary');
      }
      
      case 'UnaryExpr': {
        const unary = node as UnaryExpr;
        const operand = this.transpileExpr(unary.operand);
        const customFn = this.operatorFns.get(unary.operator);
        if (customFn) {
          return `${customFn}(${operand})`;
        }

        this.throwUndefinedOperatorError(unary.operator, unary, 'unary');
      }
      
      case 'IndexExpr': {
        const index = node as IndexExpr;
        const object = this.transpileExpr(index.object);
        const idx = this.transpileExpr(index.index);
        return `${object}.get(${idx})`;
      }
      
      case 'MemberExpr': {
        const member = node as MemberExpr;
        return this.transpileMemberExpr(member);
      }
      
      case 'CallExpr': {
        const call = node as CallExpr;
        let calleeStr = call.callee.type === 'Identifier'
          ? this.resolveIdentifierReference((call.callee as Identifier).name, false)
          : this.transpileExpr(call.callee);
        let isPrintCall = false;
        
        // Detect print() usage and mark runtime as needed
        if (call.callee.type === 'Identifier') {
          const funcName = (call.callee as Identifier).name;
          if (funcName === 'print') {
            isPrintCall = true;
          }
        }
        
        if (call.callee.type === 'MemberExpr' && call.args.length === 0) {
          return `${calleeStr}()`;
        }
        if (call.args.length === 0) {
          return `${calleeStr}()`;
        }
        
        const args = call.args.map(a => this.transpileExpr(a)).join(', ');
        const argCount = call.args.length;

        if (isPrintCall && call.args.length === 1 && this.isShowAvailable()) {
          return `${calleeStr}(show(${args}))`;
        }
        
        // Check for currying: if calling a known function with fewer args than params
        if (call.callee.type === 'Identifier') {
          const funcName = (call.callee as Identifier).name;
          const paramCount = this.functions.get(funcName);
          if (paramCount !== undefined && argCount < paramCount) {
            // Generate curried function: (_c1) => (_c2) => fn(arg1, _c1, _c2)
            let result = '';
            for (let i = argCount; i < paramCount; i++) {
              result += `(_c${i}) => `;
            }
            result += `${calleeStr}(${args}`;
            for (let i = argCount; i < paramCount; i++) {
              result += `, _c${i}`;
            }
            result += ')';
            return result;
          }
        }
        
        // Wrap arrow functions in parentheses when called (for precedence)
        if (calleeStr.startsWith('(') && calleeStr.includes('=>')) {
          calleeStr = `(${calleeStr})`;
        }
        
        return `${calleeStr}(${args})`;
      }
      
      case 'FunctionExpr': {
        const fn = node as FunctionExpr;
        const params = fn.params.map(p => p.name).join(', ');
        fn.params.forEach(param => this.assertNotReservedIdentifier(param.name));
        const body = this.withScope(() => {
          fn.params.forEach(param => this.declareName(param.name));
          return this.transpileExpr(fn.body);
        });
        const getOperator = (op: string) => op === '++' ? '+' : op;
        if (fn.params.length === 1 && fn.params[0].name === '_left' && fn.body.type === 'BinaryExpr') {
          const bin = fn.body as BinaryExpr;
          if (bin.left.type === 'Identifier' && (bin.left as Identifier).name === '_left') {
            const op = getOperator(bin.operator);
            const right = this.transpileExpr(bin.right);
            return `(_left) => (_left ${op} ${right})`;
          }
          if (bin.right.type === 'Identifier' && (bin.right as Identifier).name === '_left') {
            const op = getOperator(bin.operator);
            const left = this.transpileExpr(bin.left);
            return `(_right) => (${left} ${op} _right)`;
          }
        }
        if (fn.params.length === 2 && fn.params[0].name === '_left' && fn.params[1].name === '_right' && fn.body.type === 'BinaryExpr') {
          const bin = fn.body as BinaryExpr;
            const op = getOperator(bin.operator);
          return `(_left, _right) => (_left ${op} _right)`;
        }
        const paramNames = new Set(fn.params.map(p => p.name));
        const aliasLines: string[] = ['const __args = Array.from(arguments);'];
        if (!paramNames.has('params')) {
          aliasLines.push('const params = __args;');
        }
        return `function(${params}) { ${aliasLines.join(' ')} return ${body}; }`;
      }
      
      case 'IfExpr': {
        const ifExpr = node as IfExpr;
        const condition = this.transpileExpr(ifExpr.condition);
        const thenBranch = this.transpileExpr(ifExpr.thenBranch);
        const elseBranch = this.transpileExpr(ifExpr.elseBranch);
        this.needsBoolHelpers = true;
        return `(__boolToJs(${condition}) ? ${thenBranch} : ${elseBranch})`;
      }
      
      case 'MatchExpr': {
        const match = node as MatchExpr;
        return this.transpileMatchExpr(match);
      }
      
      case 'RecordLiteral': {
        const record = node as RecordLiteral;
        const fields = record.fields.map(f => 
          `${f.key}: ${this.transpileExpr(f.value)}`
        ).join(', ');
        return `{ ${fields} }`;
      }
      
      case 'ListLiteral': {
        const list = node as ListLiteral;
        return this.buildListLiteral(list.elements);
      }
      
      case 'TupleLiteral': {
        const tuple = node as TupleLiteral;
        const elements = tuple.elements.map(e => this.transpileExpr(e)).join(', ');
        return `[${elements}]`;
      }
      
      case 'PipeExpr': {
        const pipe = node as PipeExpr;
        return this.transpilePipeExpr(pipe);
      }
      
      case 'BlockExpr': {
        const block = node as BlockExpr;
        const statements = block.body.slice(0, -1);
        const last = block.body[block.body.length - 1];
        for (const stmt of statements) {
          this.transpileNode(stmt);
        }
        return this.transpileExpr(last);
      }

      case 'ReturnExpr': {
        const ret = node as ReturnExpr;
        if (ret.value) {
          return `return ${this.transpileExpr(ret.value)}`;
        }
        return 'return';
      }
      
      case 'AwaitExpr': {
        const awaitExpr = node as AwaitExpr;
        const expr = this.transpileExpr(awaitExpr.expression);
        return `await ${expr}`;
      }
      
      case 'ForExpr': {
        const forExpr = node as ForExpr;
        const pattern = this.transpilePattern(forExpr.pattern);
        const iterable = this.transpileExpr(forExpr.iterable);
        const patternBindings = this.collectPatternBindings(forExpr.pattern);
        const body = this.withScope(() => {
          patternBindings.forEach(name => this.declareName(name));
          return this.transpileExpr(forExpr.body);
        });
        let loopCode = `for (const ${pattern} of ${iterable}) {\n`;
        this.indent++;
        const forCondition = forExpr.condition;
        if (forCondition) {
          const condition = this.withScope(() => {
            patternBindings.forEach(name => this.declareName(name));
            return this.transpileExpr(forCondition);
          });
          this.needsBoolHelpers = true;
          loopCode += this.getIndent() + `if (!__boolToJs(${condition})) continue;\n`;
        }
        loopCode += this.getIndent() + body;
        this.indent--;
        loopCode += `\n${this.getIndent()}}`;
        return loopCode;
      }
      
      case 'WhileExpr': {
        const whileExpr = node as WhileExpr;
        const condition = this.transpileExpr(whileExpr.condition);
        const body = this.transpileExpr(whileExpr.body);
        this.needsBoolHelpers = true;
        let loopCode = `while (__boolToJs(${condition})) {\n`;
        this.indent++;
        loopCode += this.getIndent() + body;
        this.indent--;
        loopCode += `\n${this.getIndent()}}`;
        return loopCode;
      }
      
      case 'BreakExpr': {
        return 'break';
      }
      
      case 'ContinueExpr': {
        return 'continue';
      }
      
      case 'ListComprehension': {
        const comp = node as ListComprehension;
        const iterable = this.transpileExpr(comp.iterable);
        const { element, guard, condition, bindings, refs } = this.withScope(() => {
          this.collectPatternBindings(comp.pattern).forEach(name => this.declareName(name));
          const transpiledElement = this.transpileExpr(comp.element);
          const patternResult = this.transpileMatchPattern(comp.pattern, '__head');
          const guardParts: string[] = [];
          if (patternResult.condition) {
            guardParts.push(`(${patternResult.condition})`);
          }
          if (comp.condition) {
            guardParts.push(`(${this.transpileExpr(comp.condition)})`);
          }
          const transpiledGuard = guardParts.length > 0 ? guardParts.join(' && ') : '__boolTrue()';
          return {
            element: transpiledElement,
            guard: transpiledGuard,
            condition: patternResult.condition,
            bindings: patternResult.bindings,
            refs: patternResult.refs,
          };
        });
        this.needsBoolHelpers = true;
        const allBindings = [refs, bindings].filter(Boolean).join('; ');
        const bindingBlock = allBindings ? `${allBindings}; ` : '';
        return `((__list) => { const __go = (__xs) => { if (!(__xs && __xs._variant === 'Cons')) { return __listNil; } const __head = __xs.head; const __tail = __xs.tail; ${bindingBlock}if (__boolToJs(${guard})) { return __listCons(${element}, __go(__tail)); } return __go(__tail); }; return __go(__list); })(${iterable})`;
      }
      
      case 'StringInterpolation': {
        const interp = node as StringInterpolation;
        let result = '`';
        for (const part of interp.parts) {
          if (part.type === 'StringPart') {
            result += (part as any).value;
          } else if (part.type === 'ExprPart') {
            const expr = this.transpileExpr((part as any).expr);
            result += `\${${expr}}`;
          }
        }
        result += '`';
        return result;
      }
      
      default:
        return 'undefined';
    }
  }

  private transpileMatchExpr(match: MatchExpr): string {
    const value = this.transpileExpr(match.value);
    const cases = match.arms.map(arm => {
      return this.withScope(() => {
        this.collectPatternBindings(arm.pattern).forEach(name => this.declareName(name));
        const { bindings, condition, refs } = this.transpileMatchPattern(arm.pattern);
        const body = this.transpileExpr(arm.body);
        let guardCondition = condition;
        if (arm.guard) {
          const guard = `__boolToJs(${this.transpileExpr(arm.guard.condition)})`;
          this.needsBoolHelpers = true;
          guardCondition = guardCondition ? `(${guardCondition} && ${guard})` : guard;
        }
        return { bindings, condition: guardCondition, body, refs };
      });
    });

    let result = `((__v) => {\n`;
    for (const c of cases) {
      let refs = c.refs;
      if (refs.endsWith('; ')) refs = refs.slice(0, -2);
      else if (refs.endsWith(';')) refs = refs.slice(0, -1);
      const allBindings = [refs, c.bindings].filter(b => b).join('; ');
      if (c.condition) {
        result += `  { ${allBindings}${allBindings ? '; ' : ''}if (${c.condition}) { return ${c.body}; } }\n`;
      } else {
        result += `  { ${allBindings}${allBindings ? '; ' : ''}return ${c.body}; }\n`;
      }
    }
    result += `})(${value})`;
    return result;
  }

  private transpileMatchPattern(pattern: Pattern, value: string = '__v'): { bindings: string; condition: string; refs: string } {
    switch (pattern.type) {
      case 'WildcardPattern':
        return { bindings: '', condition: '', refs: '' };
      case 'IdentifierPattern':
        return { bindings: '', condition: '', refs: `const ${pattern.name} = ${value}` };
      case 'LiteralPattern':
        if (pattern.literal.type === 'BooleanLiteral') {
          this.needsBoolHelpers = true;
          const lit = this.transpileExpr(pattern.literal);
          return { bindings: '', condition: `(__boolToJs(${value}) === __boolToJs(${lit}))`, refs: '' };
        }
        return { bindings: '', condition: `${value} === ${this.transpileExpr(pattern.literal)}`, refs: '' };
      case 'RecordPattern': {
        const conds: string[] = [];
        const binds: string[] = [];
        const refs: string[] = [];
        for (const f of pattern.fields) {
          const fieldValue = `${value}.${f.key}`;
          const result = this.transpileMatchPattern(f.pattern, fieldValue);
          if (result.condition) conds.push(result.condition);
          if (result.bindings) binds.push(result.bindings);
          if (result.refs) refs.push(result.refs);
        }
        return { bindings: binds.join(' '), condition: conds.join(' && '), refs: refs.join(' ') };
      }
      case 'ListPattern': {
        return this.transpileListPatternMatch(pattern, value);
      }
      case 'TuplePattern': {
        const elems = pattern.elements.map((e, i) => this.transpileMatchPattern(e, `${value}[${i}]`));
        const conds = elems.map(e => e.condition).filter(c => c);
        const binds = elems.map(e => e.bindings).filter(b => b);
        const refs = elems.map(e => e.refs).filter(r => r);
        return { bindings: binds.join(' '), condition: conds.join(' && '), refs: refs.join(' ') };
      }
      case 'ConstructorPattern': {
        // Always use _variant for ADT pattern matching (built-in and custom)
        const conds = [`${value}._variant === '${pattern.name}'`];
        const binds: string[] = [];
        const refs: string[] = [];
        const fieldNames = this.getVariantFieldNames(pattern.name);
        pattern.patterns.forEach((p, i) => {
          const fieldName = fieldNames[i] || `v${i}`;
          if (p.type === 'IdentifierPattern') {
            const bindName = (p as any).name;
            refs.push(`const ${bindName} = ${value}.${fieldName}`);
          } else {
            const result = this.transpileMatchPattern(p, `${value}.${fieldName}`);
            if (result.condition) conds.push(result.condition);
            if (result.bindings) binds.push(result.bindings);
            if (result.refs) refs.push(result.refs);
          }
        });
        return { bindings: binds.join(' '), condition: conds.join(' && '), refs: refs.join('; ') };
      }
      default:
        return { bindings: '', condition: '', refs: '' };
    }
  }

  private transpileListPatternMatch(
    pattern: Extract<Pattern, { type: 'ListPattern' }>,
    value: string
  ): { bindings: string; condition: string; refs: string } {
    const conds: string[] = [];
    const binds: string[] = [];
    const refs: string[] = [];

    let current = value;
    pattern.elements.forEach((elemPattern) => {
      conds.push(`${current} && ${current}._variant === 'Cons'`);
      const elem = this.transpileMatchPattern(elemPattern, `${current}.head`);
      if (elem.condition) conds.push(elem.condition);
      if (elem.bindings) binds.push(elem.bindings);
      if (elem.refs) refs.push(elem.refs);
      current = `${current}.tail`;
    });

    if (pattern.rest) {
      refs.push(`const ${pattern.rest} = ${current}`);
    } else {
      conds.push(`${current} && ${current}._variant === 'Nil'`);
    }

    return { bindings: binds.join(' '), condition: conds.join(' && '), refs: refs.join('; ') };
  }

  private buildListLiteral(elements: Node[]): string {
    let result = '__listNil';
    for (let i = elements.length - 1; i >= 0; i--) {
      result = `__listCons(${this.transpileExpr(elements[i])}, ${result})`;
    }
    return result;
  }

  private emitImplicitArgAliases(params: Param[]): void {
    this.emitImplicitArgAliasesForNames(params.map(p => p.name));
  }

  private emitImplicitArgAliasesForNames(paramNamesList: string[]): void {
    const paramNames = new Set(paramNamesList);
    this.writeln('const __args = Array.from(arguments);');
    this.declareName('__args');
    if (!paramNames.has('params')) {
      this.writeln('const params = __args;');
      this.declareName('params');
    }
  }

  private materializeNullaryConstructor(reference: string): string {
    return `((typeof ${reference} === 'function' && ${reference}.length === 0) ? ${reference}() : ${reference})`;
  }

  private resolveIdentifierReference(name: string, materializeConstructorValue: boolean): string {
    if (name === JS_NAMESPACE) {
      throw new Error(`The identifier '${JS_NAMESPACE}' is reserved for JavaScript interop and can only be used as ${JS_NAMESPACE}.<name>.`);
    }
    if (name === RUNTIME_NAMESPACE) {
      throw new Error(`The identifier '${RUNTIME_NAMESPACE}' is reserved for the Arix runtime and can only be used as ${RUNTIME_NAMESPACE}.<name>.`);
    }

    const fullName = this.constructors.get(name);
    if (fullName) {
      const fieldNames = this.variantFieldNames.get(name);
      if (fieldNames && fieldNames.length === 0) {
        return `${fullName}()`;
      }
      if (materializeConstructorValue && /^[A-Z]/.test(name)) {
        return this.materializeNullaryConstructor(fullName);
      }
      return fullName;
    }

    if (name === 'Nil') {
      return '__listNil';
    }
    if (name === 'Cons') {
      return '__listCons';
    }

    const importNamespace = this.importedNames.get(name);
    if (importNamespace !== undefined) {
      const resolved = importNamespace ? `${importNamespace}.${name}` : name;
      if (materializeConstructorValue && /^[A-Z]/.test(name)) {
        return this.materializeNullaryConstructor(resolved);
      }
      return resolved;
    }

    if (this.functions.has(name) || this.isNameDeclared(name)) {
      if (materializeConstructorValue && /^[A-Z]/.test(name)) {
        return this.materializeNullaryConstructor(name);
      }
      return name;
    }

    throw new Error(`Identifier '${name}' is not defined in Arix scope. Use ${JS_NAMESPACE}.${name} for JavaScript interop.`);
  }

  private transpileMemberExpr(member: MemberExpr): string {
    const property = (member.property as Identifier).name;
    if (member.object.type === 'Identifier' && (member.object as Identifier).name === JS_NAMESPACE) {
      this.runtimeImports.add('js');
      return `js.${property}`;
    }
    if (member.object.type === 'Identifier' && (member.object as Identifier).name === RUNTIME_NAMESPACE) {
      this.runtimeImports.add('runtime');
      return `runtime.${property}`;
    }
    if (member.object.type === 'MemberExpr' && this.isJsInteropMember(member.object as MemberExpr)) {
      return `${this.transpileMemberExpr(member.object as MemberExpr)}.${property}`;
    }
    const object = this.transpileExpr(member.object);
    return `${object}.${property}`;
  }

  private isJsInteropMember(node: MemberExpr): boolean {
    if (node.object.type === 'Identifier' && (node.object as Identifier).name === JS_NAMESPACE) {
      return true;
    }
    if (node.object.type === 'MemberExpr') {
      return this.isJsInteropMember(node.object as MemberExpr);
    }
    return false;
  }

  private pushScope(): void {
    this.scopeStack.push(new Set());
  }

  private popScope(): void {
    this.scopeStack.pop();
  }

  private withScope<T>(run: () => T): T {
    this.pushScope();
    try {
      return run();
    } finally {
      this.popScope();
    }
  }

  private declareName(name: string): void {
    this.assertNotReservedIdentifier(name);
    const scope = this.scopeStack[this.scopeStack.length - 1];
    scope.add(name);
  }

  private isNameDeclared(name: string): boolean {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      if (this.scopeStack[i].has(name)) {
        return true;
      }
    }
    return false;
  }

  private assertNotReservedIdentifier(name: string): void {
    if (name === JS_NAMESPACE) {
      throw new Error(`'${JS_NAMESPACE}' is a reserved namespace for JavaScript interop and cannot be declared or imported.`);
    }
    if (name === RUNTIME_NAMESPACE) {
      throw new Error(`'${RUNTIME_NAMESPACE}' is a reserved namespace for the Arix runtime and cannot be declared or imported.`);
    }
  }

  private throwUndefinedOperatorError(operator: string, node: Node, kind: 'binary' | 'unary'): never {
    const line = node.line ?? 1;
    const column = node.column ?? 1;
    const location = this.currentFilePath ? `${this.currentFilePath}:${line}:${column}` : `${line}:${column}`;
    throw new Error(
      `${location} Operator '${operator}' does not have an Arix definition for ${kind} usage. ` +
      `Declare it with @Operator(...) or import a module that defines it.`
    );
  }

  private collectPatternBindings(pattern: Pattern): string[] {
    switch (pattern.type) {
      case 'IdentifierPattern':
        return [pattern.as || pattern.name];
      case 'RecordPattern': {
        const nested = pattern.fields.flatMap(field => this.collectPatternBindings(field.pattern));
        if (pattern.rest) {
          nested.push(pattern.rest);
        }
        return nested;
      }
      case 'TuplePattern':
        return pattern.elements.flatMap(element => this.collectPatternBindings(element));
      case 'ListPattern': {
        const nested = pattern.elements.flatMap(element => this.collectPatternBindings(element));
        if (pattern.rest) {
          nested.push(pattern.rest);
        }
        return nested;
      }
      case 'ConstructorPattern':
        return pattern.patterns.flatMap(child => this.collectPatternBindings(child));
      default:
        return [];
    }
  }

  private emitListHelpers(): void {
    this.writeln('const __listIterator = function* (start) {');
    this.indent++;
    this.writeln('let current = start;');
    this.writeln('while (current && current._variant === "Cons") {');
    this.indent++;
    this.writeln('yield current.head;');
    this.writeln('current = current.tail;');
    this.indent--;
    this.writeln('}');
    this.indent--;
    this.writeln('};');
    this.writeln('const __listNil = Object.freeze({');
    this.indent++;
    this.writeln('_type: "List",');
    this.writeln('_variant: "Nil",');
    this.writeln('_values: [],');
    this.writeln('[Symbol.iterator]: function* () { }');
    this.indent--;
    this.writeln('});');
    this.writeln('const __listCons = (head, tail) => Object.freeze({');
    this.indent++;
    this.writeln('_type: "List",');
    this.writeln('_variant: "Cons",');
    this.writeln('_values: [head, tail],');
    this.writeln('head,');
    this.writeln('tail,');
    this.writeln('[Symbol.iterator]: function* () { yield* __listIterator(this); }');
    this.indent--;
    this.writeln('});');
    this.writeln('');
  }

  private getVariantFieldNames(typeName: string): string[] {
    // Check if this is a custom ADT variant first
    if (this.variantFieldNames.has(typeName)) {
      return this.variantFieldNames.get(typeName) || [];
    }
    
    const fieldMap: Record<string, string[]> = {
      'Circle': ['r'],
      'Rectangle': ['width', 'height'],
      'Ok': ['value'],
      'Err': ['error'],
      'Some': ['value'],
      'Just': ['value'],
      'Nothing': [],
      'Cons': ['head', 'tail'],
      'Nil': [],
    };
    return fieldMap[typeName] || [];
  }

  private getIndent(): string {
    return '  '.repeat(this.indent);
  }

  private transpilePipeExpr(pipe: PipeExpr): string {
    const left = this.transpileExpr(pipe.left);
    const right = pipe.right;
    
    if (right.type === 'CallExpr') {
      const call = right as CallExpr;
      const callee = this.transpileExpr(call.callee);
      const existingArgs = call.args.map(a => this.transpileExpr(a)).join(', ');
      const args = existingArgs ? `${existingArgs}, ${left}` : left;
      return `${callee}(${args})`;
    }
    
    const rightStr = this.transpileExpr(right);
    return `${rightStr}(${left})`;
  }

  private transpileTypeclassDecl(node: TypeclassDecl): void {
    this.declareName(node.name);
    this.exports.push(node.name);
    const typeclassMethodNames = node.methods.map(method => method.name);

    // Register @Operator decorators declared on typeclass methods (symbol -> method name).
    for (const method of node.methods) {
      const operatorDec = method.decorators?.find(d => d.name === 'Operator');
      if (operatorDec && operatorDec.args.length >= 1) {
        const symNode = operatorDec.args[0];
        if (symNode.type === 'StringLiteral') {
          this.operatorFns.set((symNode as any).value as string, method.name);
        }
      }
    }
    
    // Generate default implementations for methods with bodies
    for (const method of node.methods) {
      const methodBodyNode = method.body;
      if (methodBodyNode) {
        // Generate a default implementation function
        const defaultFnName = `__default_${node.name}_${method.name}`;
        const runtimeDecorators = (method.decorators || []).filter(d => d.name !== 'Operator');
        const paramList = method.params.map(p => p.name).join(', ');
        this.writeln(`let ${defaultFnName} = function(${paramList}) {`);
        this.indent++;
        const methodBody = this.withScope(() => {
          typeclassMethodNames.forEach(methodName => this.declareName(methodName));
          method.params.forEach(param => this.declareName(param.name));
          if (!method.params.some(param => param.name === 'params')) {
            this.declareName('params');
          }
          return this.transpileExpr(methodBodyNode);
        });
        this.writeln(`return ${methodBody};`);
        this.indent--;
        this.writeln('};');
        if (runtimeDecorators.length > 0) {
          this.needsDecoratorHelpers = true;
          this.writeln(`${defaultFnName} = __applyArixDecorators(${defaultFnName}, ${this.transpileDecorators(runtimeDecorators)});`);
        }
        // Export default implementations so they can be used by impl in other files
        this.exports.push(defaultFnName);
      }
    }
    
    // Typeclasses are just type declarations at transpile time
    // The actual method dispatch happens at runtime via the constraint registry
    // Generate a const that represents the typeclass interface
    this.writeln(`const ${node.name} = {`);
    this.indent++;
    
    for (const method of node.methods) {
      if (method.body) {
        this.writeln(`${method.name}: __default_${node.name}_${method.name},`);
      } else {
        this.writeln(`${method.name}: null, // Will be filled by instances`);
      }
    }
    
    this.indent--;
    this.writeln('};');
    this.writeln();
  }

  private transpileInstanceDecl(node: InstanceDecl): void {
    // Generate the instance implementation object
    // For Convertible for (Int, String), we generate something like:
    // registerInstance('Convertible', ['Int', 'String'], { convert: (x) => x.toString() });
    
    const renderForType = (typeNode: Node): string => {
      if (typeNode.type === 'Identifier') {
        return (typeNode as Identifier).name;
      }
      return this.transpileExpr(typeNode);
    };
    const forTypesStr = node.forTypes.length === 1 
      ? renderForType(node.forTypes[0])
      : `[${node.forTypes.map(t => renderForType(t)).join(', ')}]`;
    
    this.writeln(`// Instance: ${node.typeclass} for ${forTypesStr}`);
    
    // Get the pre-calculated instance variable names from first pass
    const allInstanceIds = this.instanceIds.get(node.typeclass) || [];
    // Count how many instances of this typeclass we've already processed
    let processedCount = 0;
    if (!this.constructors.has(`__processed_instances_${node.typeclass}`)) {
      this.constructors.set(`__processed_instances_${node.typeclass}`, '0');
    }
    processedCount = parseInt(this.constructors.get(`__processed_instances_${node.typeclass}`) || '0');
    
    let instanceVarName = allInstanceIds[processedCount] || `__instance_${node.typeclass}_${processedCount}`;
    this.constructors.set(`__processed_instances_${node.typeclass}`, String(processedCount + 1));
    
    // Get the typeclass to check for default implementations
    const typeclass = this.typeclasses.get(node.typeclass);
    const implementedMethods = new Set(node.methods.map(m => m.name));
    
    // Generate an object with all the methods (implementing + defaults)
    this.writeln(`const ${instanceVarName} = {`);
    this.indent++;
    
    // First, add the implemented methods
    for (const method of node.methods) {
      // Use parameter names from the implementation if available, otherwise from typeclass
      let paramNames = ['x'];
      let typeclassMethod: MethodDecl | undefined;
      if (method.params && method.params.length > 0) {
        paramNames = [...method.params];
      } else if (typeclass) {
        typeclassMethod = typeclass.methods.find(m => m.name === method.name);
        if (typeclassMethod && typeclassMethod.params.length > 0) {
          paramNames = typeclassMethod.params.map(p => p.name || 'arg');
        }
      }
      if (!typeclassMethod && typeclass) {
        typeclassMethod = typeclass.methods.find(m => m.name === method.name);
      }
      const paramList = paramNames.join(', ');
      const runtimeDecorators = [
        ...(typeclassMethod?.decorators || []),
        ...(method.decorators || []),
      ].filter(d => d.name !== 'Operator');
      
      const scopedBody = this.withScope(() => {
        paramNames.forEach(param => this.declareName(param));
        if (!paramNames.includes('params')) {
          this.declareName('params');
        }
        return this.transpileExpr(method.body);
      });
      if (runtimeDecorators.length > 0) {
        this.needsDecoratorHelpers = true;
        this.writeln(`${method.name}: __applyArixDecorators(function(${paramList}) {`);
        this.indent++;
        this.withScope(() => {
          paramNames.forEach(param => this.declareName(param));
          this.emitImplicitArgAliasesForNames(paramNames);
        });
        this.writeln(`return ${scopedBody};`);
        this.indent--;
        this.writeln(`}, ${this.transpileDecorators(runtimeDecorators)}),`);
      } else {
        this.writeln(`${method.name}: function(${paramList}) {`);
        this.indent++;
        this.withScope(() => {
          paramNames.forEach(param => this.declareName(param));
          this.emitImplicitArgAliasesForNames(paramNames);
        });
        this.writeln(`return ${scopedBody};`);
        this.indent--;
        this.writeln('},');
      }
    }
    
    // Then, add default implementations from the typeclass for methods not implemented
    if (typeclass) {
      for (const method of typeclass.methods) {
        const methodBodyNode = method.body;
        if (!implementedMethods.has(method.name) && methodBodyNode) {
          const paramNames = method.params.map(p => p.name || 'arg');
          const paramList = paramNames.join(', ');
          
          // Generate inline function for default implementation
          const methodBody = this.withScope(() => {
            paramNames.forEach(param => this.declareName(param));
            if (!paramNames.includes('params')) {
              this.declareName('params');
            }
            return this.transpileExpr(methodBodyNode);
          });
          this.writeln(`${method.name}: function(${paramList}) {`);
          this.indent++;
          this.withScope(() => {
            paramNames.forEach(param => this.declareName(param));
            this.emitImplicitArgAliasesForNames(paramNames);
          });
          this.writeln(`return ${methodBody};`);
          this.indent--;
          this.writeln('},');
        }
      }
    }
    
    this.indent--;
    this.writeln('};');
    this.writeln();
  }

  private getTypeName(typeNode: Node | any): string {
    if (typeof typeNode === 'string') {
      return typeNode;
    }
    if (typeNode.type === 'Identifier') {
      return typeNode.name;
    }
    if (typeNode.type === 'GenericType') {
      return typeNode.name; // Return base name like 'List' from 'List(a)'
    }
    if (typeNode.type === 'CallExpr' && typeNode.callee && typeNode.callee.type === 'Identifier') {
      return typeNode.callee.name; // Return 'List' from List(a)
    }
    return 'unknown';
  }

  private isShowAvailable(): boolean {
    return this.importedNames.has('show') || this.functions.has('show');
  }

  private isGeneratedDispatchMethod(name: string): boolean {
    for (const [, typeclassDecl] of this.typeclasses) {
      if (typeclassDecl.methods.some(method => method.name === name)) {
        return true;
      }
    }
    return false;
  }

  private getStdlibFallbackExports(moduleName: string): string[] {
    const fallback: Record<string, string[]> = {
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
      prelude: ['apply', 'compose', 'pipe', 'print'],
    };
    return fallback[moduleName] || [];
  }

  private generateDispatchFunctions(): void {
    // Generate dispatch functions for each typeclass method
    for (const [tcName, tc] of this.typeclasses) {
      const instanceVarNames = this.instanceIds.get(tcName) || [];
      const externalInstances = this.globalInstances.filter(inst =>
        inst.typeclass === tcName &&
        inst.methods.includes(tc.methods[0]?.name || '')
      );
      
      if (instanceVarNames.length === 0 && externalInstances.length === 0) {
        // No instances for this typeclass - skip dispatch generation
        continue;
      }

      // For each method in the typeclass, create a dispatch function
      for (const method of tc.methods) {
        const methodName = method.name;

        // Keep an existing top-level function when a module defines one with the same name.
        if (this.functions.has(methodName)) {
          continue;
        }
        
        // Register this method name as a local function (empty string means no namespace)
        this.importedNames.set(methodName, '');

        if (!this.exports.includes(methodName)) {
          this.exports.push(methodName);
        }
        
        // Extract parameter names from the method signature
        const paramNames = method.params.map(p => {
          if (p.name) return p.name;
          return 'arg';
        });
        const paramList = paramNames.join(', ');
        
        this.writeln(`// Dispatch function for ${tcName}.${methodName}`);
        this.writeln(`const ${methodName} = (${paramList}) => {`);
        this.indent++;
        
        // Try each instance in order with type checking — generic ADT last
        const sortedInstanceVarNames = [...instanceVarNames].sort((a, b) => {
          const aType = (this.instanceTypes.get(a) || [])[0];
          const bType = (this.instanceTypes.get(b) || [])[0];
          if (aType === 'ADT' && bType !== 'ADT') return 1;
          if (bType === 'ADT' && aType !== 'ADT') return -1;
          return 0;
        });
        for (const instanceVarName of sortedInstanceVarNames) {
          const typeNames = this.instanceTypes.get(instanceVarName) || [];
          const typeCheck = this.generateTypeCheck(typeNames[0], paramNames[0] || 'x');
          
          this.writeln(`if (${typeCheck}) {`);
          this.indent++;
          this.writeln(`if (${instanceVarName}.${methodName}) {`);
          this.indent++;
          this.writeln(`return ${instanceVarName}.${methodName}(${paramList});`);
          this.indent--;
          this.writeln(`}`);
          this.indent--;
          this.writeln(`}`);
        }

        // Try imported module instances (cross-module dispatch) — generic ADT last.
        const externalInstances = this.globalInstances.filter(inst =>
          inst.typeclass === tcName &&
          inst.methods.includes(methodName)
        ).sort((a, b) => {
          if (a.forTypes[0] === 'ADT' && b.forTypes[0] !== 'ADT') return 1;
          if (b.forTypes[0] === 'ADT' && a.forTypes[0] !== 'ADT') return -1;
          return 0;
        });
        for (const instance of externalInstances) {
          const moduleNamespace = this.moduleNamespaces.get(instance.module) || this.moduleNamespaces.get(instance.module.toLowerCase());
          if (!moduleNamespace) {
            continue;
          }
          const typeCheck = this.generateTypeCheck(instance.forTypes[0], paramNames[0] || 'x');
          this.writeln(`if (${typeCheck}) {`);
          this.indent++;
          this.writeln(`if (${moduleNamespace}.${methodName}) {`);
          this.indent++;
          this.writeln(`return ${moduleNamespace}.${methodName}(${paramList});`);
          this.indent--;
          this.writeln(`}`);
          this.indent--;
          this.writeln(`}`);
        }
        
        // Fallback: use default implementation if available
        const defaultBody = method.body;
        if (defaultBody) {
          const defaultImpl = this.withScope(() => {
            tc.methods.forEach(tcMethod => this.declareName(tcMethod.name));
            paramNames.forEach(param => this.declareName(param));
            if (!paramNames.includes('params')) {
              this.declareName('params');
            }
            return this.transpileExpr(defaultBody);
          });
          this.writeln(`return ${defaultImpl};`);
        } else {
          this.writeln(`throw new Error('No instance of ${tcName} found for ' + typeof ${paramNames[0]});`);
        }
        
        this.indent--;
        this.writeln('};');
        this.writeln();
      }
    }
  }

  private generateTypeCheck(typeName: string | undefined, valueRef: string = 'x'): string {
    if (!typeName) return 'true';
    
    switch (typeName) {
      case 'ADT':
        return `${valueRef} && typeof ${valueRef} === "object" && typeof ${valueRef}._type === "string" && typeof ${valueRef}._variant === "string"`;
      case 'Int':
        if (this.nativePrimitives) {
          return `__arixIsInt(${valueRef})`;
        }
        return `Number.isInteger(${valueRef})`;
      case 'String':
        return `typeof ${valueRef} === "string"`;
      case 'Boolean':
        return `(${valueRef} && ${valueRef}._type === 'Bool') || typeof ${valueRef} === "boolean"`;
      case 'Char':
        return `typeof ${valueRef} === "string" && ${valueRef}.length === 1`;
      case 'Bool':
        return `${valueRef} && ${valueRef}._type === 'Bool'`;
      case 'Float':
        if (this.nativePrimitives) {
          return `__arixIsFloat(${valueRef})`;
        }
        return `typeof ${valueRef} === "number" && !Number.isInteger(${valueRef})`;
      case 'List':
        return `${valueRef} && ${valueRef}._type === 'List'`;
      default:
        return `${valueRef} && ${valueRef}._type === '${typeName}'`;
    }
  }
}

export function transpile(ast: Program): string {
  const transpiler = new Transpiler();
  return transpiler.transpile(ast);
}
