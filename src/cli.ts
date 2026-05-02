#!/usr/bin/env node

import { parse } from './parser.js';
import { transpile, Transpiler } from './transpiler.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname, relative, basename } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { tokenize } from './lexer.js';
import { FunctionDecl, TypeDecl, ImportStmt } from './ast.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNTIME_SOURCE = join(__dirname, '..', 'runtime', 'purl-runtime.js');

const STD_LIBS = ['result', 'option', 'list'];

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
      if (command.endsWith('.purl')) {
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
Purl - Functional programming language that compiles to JavaScript

Usage:
  purl run <file>       Compile and run a Purl file
  purl build <file>     Compile to dist/ directory
  purl init <name>      Create a new Purl project
  purl <file.purl>      Compile and run (shortcut)

Examples:
  purl run hello.purl
  purl hello.purl
  purl build main.purl
  purl init my-project
`);
}

async function run(file: string | undefined) {
  if (!file) {
    console.error('Error: No file specified');
    console.log('Usage: purl run <file.purl>');
    process.exit(1);
  }

  if (!file.endsWith('.purl')) {
    file += '.purl';
  }

  if (!existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }

  const tmpDir = join(process.cwd(), '.purl-tmp');
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }

  try {
    console.log(`Compiling ${file}...`);
    const compiled = compileWithDeps(file, tmpDir, true);

    for (const [outputFile, code] of Object.entries(compiled)) {
      writeFileSync(outputFile, code);
    }

    const jsFile = join(tmpDir, basename(file, '.purl') + '.js');
    console.log(`Running ${jsFile}...\n`);

    const { execSync } = await import('child_process');
    const fileUrl = pathToFileURL(jsFile).href;
    execSync(`node "${jsFile}"`, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

async function build(file: string | undefined, outputDir = 'dist') {
  if (!file) {
    console.error('Error: No file specified');
    console.log('Usage: purl build <file.purl>');
    process.exit(1);
  }

  if (!file.endsWith('.purl')) {
    file += '.purl';
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

    console.log('\nRun with: node ' + join(outputDir, basename(file, '.purl') + '.js'));
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

function initProject(name: string | undefined) {
  if (!name) {
    console.error('Error: Project name required');
    console.log('Usage: purl init <project-name>');
    process.exit(1);
  }

  const projectDir = join(process.cwd(), name);
  if (existsSync(projectDir)) {
    console.error(`Error: Directory already exists: ${name}`);
    process.exit(1);
  }

  mkdirSync(projectDir, { recursive: true });
  mkdirSync(join(projectDir, 'src'), { recursive: true });

  writeFileSync(join(projectDir, 'src', 'main.purl'), `public fn main() = {
    print("Hello, Purl!")
}
`);

  writeFileSync(join(projectDir, 'README.md'), `# ${name}

A Purl project.

## Run
\`\`\`bash
purl run src/main.purl
\`\`\`
`);

  console.log(`Created project: ${name}/`);
  console.log(`  src/main.purl`);
  console.log(`  README.md`);
  console.log(`\nRun: cd ${name} && purl run src/main.purl`);
}

function collectModuleInfo(purlFile: string): ModuleInfo {
  const source = readFileSync(purlFile, 'utf-8');
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
    }
    if (node.type === 'ImportStmt') {
      const imp = node as ImportStmt;
      imports.push(imp.module);
    }
  }

  return { filePath: purlFile, exports, imports };
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
      if (STD_LIBS.includes(moduleName.toLowerCase())) continue;

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

  function compileFile(purlFile: string, isMain = false): void {
    if (compiled[purlFile]) return;

    const relFromEntry = relative(entryDir, purlFile).replace(/\\/g, '/');
    const dir = join(outputDir, dirname(relFromEntry));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const outputFileDir = dir;
    const outputFile = join(dir, purlFile.replace(/\.purl$/, '.js').replace(/\\/g, '/').split('/').pop()!);

    const source = readFileSync(purlFile, 'utf-8');
    if (process.env.DEBUG) console.log('Tokens:', tokenize(source));

    const ast = parse(source);
    const transpiler = new Transpiler();
    transpiler.setModuleInfo(moduleNameToInfo);
    transpiler.setOutputDir(outputFileDir);
    transpiler.setAutoRunMain(autoRunMain && isMain);

    const jsCode = transpiler.transpile(ast, purlFile);
    compiled[outputFile] = jsCode;
  }

  for (const [filePath] of moduleInfoMap) {
    compileFile(filePath, filePath === entryFile);
  }

  if (existsSync(RUNTIME_SOURCE)) {
    const runtimeDest = join(outputDir, 'purl-runtime.js');
    copyFileSync(RUNTIME_SOURCE, runtimeDest);
  }

  return compiled;
}

function resolveModule(moduleName: string, fromDir: string): string | null {
  if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
    const basePath = join(fromDir, moduleName + '.purl');
    if (existsSync(basePath)) {
      return basePath;
    }
  }

  const searchPaths = [fromDir, join(fromDir, 'src'), process.cwd(), join(process.cwd(), 'src')];

  for (const searchDir of searchPaths) {
    const filePath = join(searchDir, moduleName + '.purl');
    if (existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

main();
