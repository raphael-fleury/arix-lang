#!/usr/bin/env node

import { parse, extractOperators, OperatorInfo } from './parser.js';
import { Transpiler } from './transpiler.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize } from './lexer.js';
import { FunctionDecl, TypeDecl, TypeclassDecl, ImportStmt, InstanceDecl } from './ast.js';
import { TypeChecker } from './typechecker.js';
import { CompilerDiagnostic, formatDiagnostic } from './diagnostics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNTIME_SOURCE = join(__dirname, '..', 'runtime', 'arix-runtime.js');

const STD_LIB_DIR = join(__dirname, '..', 'stdlib');
const STD_LIB_TYPECLASSES_DIR = join(STD_LIB_DIR, 'typeclasses');
const STDLIB_MODULES = ['bool', 'eq', 'num', 'ord', 'result', 'maybe', 'list', 'show', 'functor', 'applicative', 'monad', 'monoid', 'prelude'];
const STDLIB_TYPECLASS_MODULES = new Set(['eq', 'ord', 'num', 'show', 'functor', 'applicative', 'monad', 'monoid']);

function getStdlibModulePath(moduleName: string): string {
  if (STDLIB_TYPECLASS_MODULES.has(moduleName)) {
    return join(STD_LIB_TYPECLASSES_DIR, moduleName + '.arix');
  }
  return join(STD_LIB_DIR, moduleName + '.arix');
}

interface ModuleInfo {
  filePath: string;
  exports: string[];
  imports: string[];
  operatorDecls: { symbol: string; kind: 'infix' | 'prefix' | 'suffix'; assoc: string; prec: number; fnName: string }[];
}

interface GlobalInstanceInfo {
  typeclass: string;
  forTypes: string[];
  methods: string[];
  module: string;
}

interface CompilationContext {
  moduleInfoMap: Map<string, ModuleInfo>;
  moduleNameToInfo: Map<string, ModuleInfo>;
  fileToModuleSpecifier: Map<string, string>;
  globalTypeclasses: Map<string, TypeclassDecl>;
  globalInstances: GlobalInstanceInfo[];
  entryDir: string;
}

function getTypeName(typeNode: any): string {
  if (!typeNode) return 'unknown';
  if (typeof typeNode === 'string') return typeNode;
  if (typeNode.type === 'Identifier') return typeNode.name;
  if (typeNode.type === 'GenericType') return typeNode.name;
  if (typeNode.type === 'CallExpr' && typeNode.callee?.type === 'Identifier') {
    return typeNode.callee.name;
  }
  return 'unknown';
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command) {
    case 'run':
      await run(args[1]);
      break;
    case 'build':
      await build(args[1]);
      break;
    case 'check':
      await check(args[1]);
      break;
    case 'init':
      initProject(args[1]);
      break;
    case '--help':
    case '-h':
    case 'help':
      printHelp();
      break;
    default:
      if (command.endsWith('.arix')) {
        await run(command);
      } else {
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
      }
  }
}

function printHelp() {
  console.log(`
Arix - Functional programming language that compiles to JavaScript

Usage:
  arix run <file>       Compile and run a Arix file
  arix build <file>     Compile to dist/ directory
  arix check <file>     Run semantic/type checks only
  arix init <name>      Create a new Arix project
  arix <file.arix>      Compile and run (shortcut)

Examples:
  arix run hello.arix
  arix hello.arix
  arix build main.arix
  arix check main.arix
  arix init my-project
`);
}

async function run(file: string | undefined) {
  if (!file) {
    console.error('Error: No file specified');
    console.log('Usage: arix run <file.arix>');
    process.exit(1);
  }

  if (!file.endsWith('.arix')) {
    file += '.arix';
  }

  if (!existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }

  const tmpDir = join(process.cwd(), '.arix-tmp');
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }

  try {
    console.log(`Compiling ${file}...`);
    const compiled = compileWithDeps(file, tmpDir, true);

    for (const [outputFile, code] of Object.entries(compiled)) {
      writeFileSync(outputFile, code);
    }

    const jsFile = join(tmpDir, basename(file, '.arix') + '.js');
    console.log(`Running ${jsFile}...\n`);

    const { execSync } = await import('node:child_process');
    execSync(`node "${jsFile}"`, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

async function build(file: string | undefined, outputDir = 'dist') {
  if (!file) {
    console.error('Error: No file specified');
    console.log('Usage: arix build <file.arix>');
    process.exit(1);
  }

  if (!file.endsWith('.arix')) {
    file += '.arix';
  }

  if (!existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }

  try {
    console.log(`Building ${file}...`);
    const compiled = compileWithDeps(file, outputDir);

    for (const [outputFile, code] of Object.entries(compiled)) {
      writeFileSync(outputFile, code);
      console.log(`  Written: ${relative(process.cwd(), outputFile)}`);
    }

    console.log('\nRun with: node ' + join(outputDir, basename(file, '.arix') + '.js'));
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

async function check(file: string | undefined) {
  if (!file) {
    console.error('Error: No file specified');
    console.log('Usage: arix check <file.arix>');
    process.exit(1);
  }

  if (!file.endsWith('.arix')) {
    file += '.arix';
  }

  if (!existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }

  try {
    console.log(`Checking ${file}...`);
    const diagnostics = checkWithDeps(file);
    if (diagnostics.length === 0) {
      console.log('No semantic/type errors found.');
      return;
    }

    printDiagnostics(diagnostics);
    process.exit(1);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

function initProject(name: string | undefined) {
  if (!name) {
    console.error('Error: Project name required');
    console.log('Usage: arix init <project-name>');
    process.exit(1);
  }

  const projectDir = join(process.cwd(), name);
  if (existsSync(projectDir)) {
    console.error(`Error: Directory already exists: ${name}`);
    process.exit(1);
  }

  mkdirSync(projectDir, { recursive: true });
  mkdirSync(join(projectDir, 'src'), { recursive: true });

  writeFileSync(join(projectDir, 'src', 'main.arix'), `public fn main() = {
    print("Hello, Arix!")
}
`);

  writeFileSync(join(projectDir, 'README.md'), `# ${name}

A Arix project.

## Run
\`\`\`bash
arix run src/main.arix
\`\`\`
`);

  console.log(`Created project: ${name}/`);
  console.log(`  src/main.arix`);
  console.log(`  README.md`);
  console.log(`\nRun: cd ${name} && arix run src/main.arix`);
}

function collectModuleInfo(arixFile: string): ModuleInfo {
  const source = readFileSync(arixFile, 'utf-8');
  const ast = parse(source);

  const exports: string[] = [];
  const imports: string[] = [];
  const operatorDecls: { symbol: string; kind: 'infix' | 'prefix' | 'suffix'; assoc: string; prec: number; fnName: string }[] = [];

  for (const node of ast.body) {
    if (node.type === 'FunctionDecl') {
      const fn = node as FunctionDecl;
      if (fn.visibility === 'public') {
        exports.push(fn.name);
      }
      const opDec = fn.decorators?.find(d => d.name === 'Operator');
      if (opDec && opDec.args.length >= 3) {
        const symNode = opDec.args[0];
        const assocNode = opDec.args[1];
        const precNode = opDec.args[2];
        if (symNode.type === 'StringLiteral' && assocNode.type === 'StringLiteral' && precNode.type === 'NumberLiteral') {
          const assocValue = (assocNode as any).value.toLowerCase();
          operatorDecls.push({
            symbol: (symNode as any).value,
            kind: assocValue.startsWith('prefix') ? 'prefix' : assocValue.startsWith('suffix') ? 'suffix' : 'infix',
            assoc: (assocNode as any).value,
            prec: (precNode as any).value,
            fnName: fn.name,
          });
        }
      }
    }
    if (node.type === 'TypeDecl') {
      const type = node as TypeDecl;
      exports.push(type.name);
      for (const variant of type.variants) {
        exports.push(variant.name);
      }
    }
    if (node.type === 'TypeclassDecl') {
      const tc = node as TypeclassDecl;
      exports.push(tc.name);
      // Extract operators from typeclass methods
      for (const method of tc.methods) {
        const opDec = method.decorators?.find(d => d.name === 'Operator');
        if (opDec && opDec.args.length >= 3) {
          const symNode = opDec.args[0];
          const assocNode = opDec.args[1];
          const precNode = opDec.args[2];
          if (symNode.type === 'StringLiteral' && assocNode.type === 'StringLiteral' && precNode.type === 'NumberLiteral') {
            const assocValue = (assocNode as any).value.toLowerCase();
            operatorDecls.push({
              symbol: (symNode as any).value,
              kind: assocValue.startsWith('prefix') ? 'prefix' : assocValue.startsWith('suffix') ? 'suffix' : 'infix',
              assoc: (assocNode as any).value,
              prec: (precNode as any).value,
              fnName: method.name,
            });
          }
        }
      }
    }
    if (node.type === 'InstanceDecl') {
      const inst = node as InstanceDecl;
      // Instance methods are generated as dispatch functions and should be importable.
      for (const method of inst.methods) {
        if (!exports.includes(method.name)) {
          exports.push(method.name);
        }
      }
    }
    if (node.type === 'ImportStmt') {
      const imp = node as ImportStmt;
      imports.push(imp.module);
    }
  }

  return { filePath: arixFile, exports, imports, operatorDecls };
}

function createCompilationContext(entryFile: string): CompilationContext {
  const moduleInfoMap: Map<string, ModuleInfo> = new Map();
  const moduleNameToInfo: Map<string, ModuleInfo> = new Map();
  const fileToModuleSpecifier: Map<string, string> = new Map();
  const entryDir = dirname(entryFile);

  function collectModule(filePath: string): void {
    if (moduleInfoMap.has(filePath)) return;

    const info = collectModuleInfo(filePath);
    moduleInfoMap.set(filePath, info);

    for (const moduleName of info.imports) {
      const depFile = resolveModule(moduleName, dirname(filePath));
      if (depFile && existsSync(depFile)) {
        if (!fileToModuleSpecifier.has(depFile)) {
          fileToModuleSpecifier.set(depFile, moduleName);
        }
        collectModule(depFile);
        const depInfo = moduleInfoMap.get(depFile);
        if (depInfo) {
          moduleNameToInfo.set(moduleName, depInfo);
        }
      }
    }
  }

  collectModule(entryFile);

  for (const moduleName of STDLIB_MODULES) {
    const stdlibFile = getStdlibModulePath(moduleName);
    if (!existsSync(stdlibFile)) {
      continue;
    }
    if (!fileToModuleSpecifier.has(stdlibFile)) {
      fileToModuleSpecifier.set(stdlibFile, moduleName);
    }
    collectModule(stdlibFile);
    const stdlibInfo = moduleInfoMap.get(stdlibFile);
    if (stdlibInfo) {
      moduleNameToInfo.set(moduleName, stdlibInfo);
    }
  }

  function collectTypeclasses(): Map<string, TypeclassDecl> {
    const allTypeclasses: Map<string, TypeclassDecl> = new Map();

    for (const filePath of moduleInfoMap.keys()) {
      const source = readFileSync(filePath, 'utf-8');
      const ast = parse(source);

      for (const node of ast.body) {
        if (node.type === 'TypeclassDecl') {
          const tc = node as TypeclassDecl;
          allTypeclasses.set(tc.name, tc);
        }
      }
    }

    return allTypeclasses;
  }

  function collectGlobalInstances(): GlobalInstanceInfo[] {
    const allInstances: GlobalInstanceInfo[] = [];

    for (const [filePath] of moduleInfoMap) {
      const source = readFileSync(filePath, 'utf-8');
      const ast = parse(source);
      const moduleName = fileToModuleSpecifier.get(filePath) || basename(filePath, '.arix');

      for (const node of ast.body) {
        if (node.type === 'InstanceDecl') {
          const inst = node as InstanceDecl;
          allInstances.push({
            typeclass: inst.typeclass,
            forTypes: inst.forTypes.map(t => getTypeName(t)),
            methods: inst.methods.map(m => m.name),
            module: moduleName,
          });
        }
      }
    }

    return allInstances;
  }

  return {
    moduleInfoMap,
    moduleNameToInfo,
    fileToModuleSpecifier,
    globalTypeclasses: collectTypeclasses(),
    globalInstances: collectGlobalInstances(),
    entryDir,
  };
}

function collectGlobalAdtVariants(moduleInfoMap: Map<string, ModuleInfo>): Map<string, string[]> {
  const variantsByType = new Map<string, string[]>();

  for (const [filePath] of moduleInfoMap) {
    const source = readFileSync(filePath, 'utf-8');
    const ast = parse(source);
    for (const node of ast.body) {
      if (node.type === 'TypeDecl') {
        const decl = node as TypeDecl;
        variantsByType.set(decl.name, decl.variants.map(v => v.name));
      }
    }
  }

  return variantsByType;
}

function checkWithDeps(entryFile: string): CompilerDiagnostic[] {
  const context = createCompilationContext(entryFile);
  const diagnostics: CompilerDiagnostic[] = [];
  const adtVariants = collectGlobalAdtVariants(context.moduleInfoMap);

  for (const [filePath, fileInfo] of context.moduleInfoMap) {
    const source = readFileSync(filePath, 'utf-8');

    const externalOperators = new Map<string, OperatorInfo>();
    for (const importedModule of fileInfo.imports) {
      const depFile = resolveModule(importedModule, dirname(filePath));
      if (!depFile) {
        continue;
      }

      const depInfo = context.moduleInfoMap.get(depFile);
      if (!depInfo) {
        continue;
      }

      for (const op of depInfo.operatorDecls) {
        const associativity: 'left' | 'right' | 'none' =
          op.assoc.toLowerCase() === 'infixr' ? 'right' :
          op.assoc.toLowerCase() === 'infixl' ? 'left' :
          'none';
        externalOperators.set(op.symbol, { precedence: op.prec, associativity, kind: op.kind, fnName: op.fnName });
      }
    }

    const ast = parse(source, externalOperators);
    const checker = new TypeChecker({
      moduleInfoMap: context.moduleNameToInfo,
      globalTypeclasses: context.globalTypeclasses,
      globalAdtVariants: adtVariants,
      stdlibModules: STDLIB_MODULES,
      isStdlibSource: filePath.startsWith(STD_LIB_DIR),
    });

    diagnostics.push(...checker.check(ast, filePath));
  }

  return diagnostics;
}

function printDiagnostics(diagnostics: CompilerDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const printer = diagnostic.severity === 'error' ? console.error : console.log;
    printer(formatDiagnostic(diagnostic));
  }
}

function compileWithDeps(entryFile: string, outputDir: string, autoRunMain = false): Record<string, string> {
  const compiled: Record<string, string> = {};
  const context = createCompilationContext(entryFile);
  const typeDiagnostics = checkWithDeps(entryFile);
  if (typeDiagnostics.length > 0) {
    printDiagnostics(typeDiagnostics);
    throw new Error('Type checking failed.');
  }

  // Collect ALL operators globally before compilation
  const globalOperatorFns = new Map<string, string>();
  for (const [filePath, fileInfo] of context.moduleInfoMap) {
    for (const op of fileInfo.operatorDecls) {
      globalOperatorFns.set(op.symbol, op.fnName);
    }
  }

  if (process.env.DEBUG && globalOperatorFns.size > 0) {
    console.log(`Global operators available: ${Array.from(globalOperatorFns.keys()).join(', ')}`);
  }

  function compileFile(arixFile: string, isMain = false): void {
    if (compiled[arixFile]) return;

    const isStdLib = arixFile.startsWith(STD_LIB_DIR);
    let outputFile: string;

    if (isStdLib) {
      outputFile = join(outputDir, basename(arixFile, '.arix') + '.js');
    } else {
      const relFromEntry = relative(context.entryDir, arixFile).replaceAll('\\', '/');
      const dir = join(outputDir, dirname(relFromEntry));
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      outputFile = join(dir, basename(arixFile, '.arix') + '.js');
    }

    const outputFileDir = dirname(outputFile);
    if (!existsSync(outputFileDir)) {
      mkdirSync(outputFileDir, { recursive: true });
    }

    const source = readFileSync(arixFile, 'utf-8');
    if (process.env.DEBUG) console.log('Tokens:', tokenize(source));

    // Collect operator declarations from all imported modules so the parser
    // knows their precedence/associativity when parsing this file.
    const externalOperators = new Map<string, OperatorInfo>();
    const externalOperatorFns = new Map<string, string>();
    const fileInfo = context.moduleInfoMap.get(arixFile);
    if (fileInfo) {
      for (const importedModule of fileInfo.imports) {
        const depFile = resolveModule(importedModule, dirname(arixFile));
        if (depFile) {
          const depInfo = context.moduleInfoMap.get(depFile);
          if (depInfo) {
            if (process.env.DEBUG) console.log(`Module ${depFile}: ${depInfo.operatorDecls.length} operators`);
            for (const op of depInfo.operatorDecls) {
              const associativity: 'left' | 'right' | 'none' =
                op.assoc.toLowerCase() === 'infixr' ? 'right' :
                op.assoc.toLowerCase() === 'infixl' ? 'left' :
                'none';
              externalOperators.set(op.symbol, { precedence: op.prec, associativity, kind: op.kind, fnName: op.fnName });
              externalOperatorFns.set(op.symbol, op.fnName);
              if (process.env.DEBUG) console.log(`  Added operator: ${op.symbol} => ${op.fnName}`);
            }
          }
        }
      }
    }

    if (process.env.DEBUG) console.log(`File ${arixFile}: externalOperatorFns.size = ${externalOperatorFns.size}`);

    const ast = parse(source, externalOperators);
    const transpiler = new Transpiler();
    transpiler.setModuleInfo(context.moduleNameToInfo);
    transpiler.setGlobalTypeclasses(context.globalTypeclasses);
    transpiler.setGlobalInstances(context.globalInstances);
    transpiler.setOutputDir(outputFileDir);
    transpiler.setAutoRunMain(autoRunMain && isMain);
    // Set all global operators, not just the local ones
    if (globalOperatorFns.size > 0) {
      if (process.env.DEBUG) console.log(`Setting operator functions: ${Array.from(globalOperatorFns.keys()).join(', ')}`);
      transpiler.setOperatorFns(globalOperatorFns);
    }

    const jsCode = transpiler.transpile(ast, arixFile);
    compiled[outputFile] = jsCode;
  }

  for (const [filePath] of context.moduleInfoMap) {
    compileFile(filePath, filePath === entryFile);
  }

  if (existsSync(RUNTIME_SOURCE)) {
    const runtimeDest = join(outputDir, 'arix-runtime.js');
    copyFileSync(RUNTIME_SOURCE, runtimeDest);
  }

  return compiled;
}

function resolveModule(moduleName: string, fromDir: string): string | null {
  if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
    const basePath = join(fromDir, moduleName + '.arix');
    if (existsSync(basePath)) {
      return basePath;
    }
  }

  const stdLibPath = getStdlibModulePath(moduleName);
  if (existsSync(stdLibPath)) {
    return stdLibPath;
  }

  const searchPaths = [fromDir, join(fromDir, 'src'), process.cwd(), join(process.cwd(), 'src')];

  for (const searchDir of searchPaths) {
    const filePath = join(searchDir, moduleName + '.arix');
    if (existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

await main();
