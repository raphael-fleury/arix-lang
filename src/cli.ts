#!/usr/bin/env node

import { parse } from './parser.js';
import { Transpiler } from './transpiler.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize } from './lexer.js';
import { FunctionDecl, TypeDecl, TypeclassDecl, ImportStmt } from './ast.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNTIME_SOURCE = join(__dirname, '..', 'runtime', 'arix-runtime.js');

const STD_LIB_DIR = join(__dirname, '..', 'stdlib');

interface ModuleInfo {
  filePath: string;
  exports: string[];
  imports: string[];
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
  arix init <name>      Create a new Arix project
  arix <file.arix>      Compile and run (shortcut)

Examples:
  arix run hello.arix
  arix hello.arix
  arix build main.arix
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

  for (const node of ast.body) {
    if (node.type === 'FunctionDecl') {
      const fn = node as FunctionDecl;
      if (fn.visibility === 'public') {
        exports.push(fn.name);
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
      for (const method of tc.methods) {
        exports.push(method.name);
      }
    }
    if (node.type === 'InstanceDecl') {
      // Instances are not directly exported by name, but they provide implementations
    }
    if (node.type === 'ImportStmt') {
      const imp = node as ImportStmt;
      imports.push(imp.module);
    }
  }

  return { filePath: arixFile, exports, imports };
}

function compileWithDeps(entryFile: string, outputDir: string, autoRunMain = false): Record<string, string> {
  const compiled: Record<string, string> = {};
  const moduleInfoMap: Map<string, ModuleInfo> = new Map();
  const moduleNameToInfo: Map<string, ModuleInfo> = new Map();
  const entryDir = dirname(entryFile);

  function collectModule(filePath: string): void {
    if (moduleInfoMap.has(filePath)) return;

    const info = collectModuleInfo(filePath);
    moduleInfoMap.set(filePath, info);

    for (const moduleName of info.imports) {
      const depFile = resolveModule(moduleName, dirname(filePath));
      if (depFile && existsSync(depFile)) {
        collectModule(depFile);
        const depInfo = moduleInfoMap.get(depFile);
        if (depInfo) {
          moduleNameToInfo.set(moduleName, depInfo);
        }
      }
    }
  }

  collectModule(entryFile);

  function compileFile(arixFile: string, isMain = false): void {
    if (compiled[arixFile]) return;

    const isStdLib = arixFile.startsWith(STD_LIB_DIR);
    let outputFile: string;

    if (isStdLib) {
      outputFile = join(outputDir, basename(arixFile, '.arix') + '.js');
    } else {
      const relFromEntry = relative(entryDir, arixFile).replaceAll('\\', '/');
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

    const ast = parse(source);
    const transpiler = new Transpiler();
    transpiler.setModuleInfo(moduleNameToInfo);
    transpiler.setOutputDir(outputFileDir);
    transpiler.setAutoRunMain(autoRunMain && isMain);

    const jsCode = transpiler.transpile(ast, arixFile);
    compiled[outputFile] = jsCode;
  }

  for (const [filePath] of moduleInfoMap) {
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

  const stdLibPath = join(STD_LIB_DIR, moduleName + '.arix');
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
