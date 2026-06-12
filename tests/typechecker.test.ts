import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser.js';
import type { TypeclassDecl } from '../src/ast.js';
import { TypeChecker } from '../src/typechecker.js';

function runCheck(source: string) {
  const checker = new TypeChecker({
    moduleInfoMap: new Map(),
    globalTypeclasses: new Map<string, TypeclassDecl>(),
  });

  return checker.check(parse(source), 'test.arix');
}

describe('TypeChecker', () => {
  it('reports undefined identifiers', () => {
    const diagnostics = runCheck('fn main() = x + 1');
    expect(diagnostics.some(d => d.code === 'ARX1001')).toBe(true);
    expect(diagnostics.some(d => d.message.includes("Identifier 'x'"))).toBe(true);
  });

  it('allows parameters and local let bindings', () => {
    const diagnostics = runCheck('fn add(a, b) =\n  let c = a + b\n  c');
    expect(diagnostics).toHaveLength(0);
  });

  it('reports arity errors for calls with too many arguments', () => {
    const diagnostics = runCheck('fn add(a, b) = a + b\nfn main() = add(1, 2, 3)');
    expect(diagnostics.some(d => d.code === 'ARX1002')).toBe(true);
  });

  it('validates missing required methods in instances', () => {
    const diagnostics = runCheck(
      [
        'typeclass Show(a)',
        '  show(x a) -> String',
        'impl Show for Int',
        '  other(x) = x',
      ].join('\n'),
    );

    expect(diagnostics.some(d => d.code === 'ARX2002')).toBe(true);
    expect(diagnostics.some(d => d.code === 'ARX2003')).toBe(true);
  });

  it('reports non-exhaustive match for typed ADT values', () => {
    const diagnostics = runCheck(
      [
        'type Status = Active | Inactive',
        'fn describe(s Status) = match s: Active -> "active"',
      ].join('\n'),
    );

    expect(diagnostics.some(d => d.code === 'ARX4001')).toBe(true);
  });

  it('accepts exhaustive match', () => {
    const diagnostics = runCheck(
      [
        'type Status = Active | Inactive',
        'fn describe(s Status) = match s: Active -> "active" Inactive -> "inactive"',
      ].join('\n'),
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('rejects reserved js identifier declarations', () => {
    const diagnostics = runCheck('fn main(js) = js');
    expect(diagnostics.some(d => d.code === 'ARX1003' || d.code === 'ARX1004')).toBe(true);
  });

  it('validates unknown type variables in typeclass where constraints', () => {
    const diagnostics = runCheck(
      [
        'typeclass Eq(a)',
        '  eq(x a, y a) -> Boolean',
        'typeclass Ord(a) where Eq(b)',
        '  lt(x a, y a) -> Boolean',
      ].join('\n'),
    );

    expect(diagnostics.some(d => d.code === 'ARX3003')).toBe(true);
  });

  it('validates unbound type variables in impl where constraints', () => {
    const diagnostics = runCheck(
      [
        'typeclass Eq(a)',
        '  eq(x a, y a) -> Boolean',
        'typeclass Show(a)',
        '  show(x a) -> String',
        'impl Show for List(a) where Eq(b)',
        '  show(x) = "[]"',
      ].join('\n'),
    );

    expect(diagnostics.some(d => d.code === 'ARX3004')).toBe(true);
  });

  it('validates inherited typeclass constraints for impl declarations', () => {
    const diagnostics = runCheck(
      [
        'typeclass Eq(a)',
        '  eq(x a, y a) -> Boolean',
        'typeclass Ord(a) where Eq(a)',
        '  lt(x a, y a) -> Boolean',
        'impl Ord for Int',
        '  lt(x, y) = x < y',
      ].join('\n'),
    );

    expect(diagnostics.some(d => d.code === 'ARX3005')).toBe(true);
  });

  it('validates unsatisfied concrete constraints in function calls', () => {
    const diagnostics = runCheck(
      [
        'typeclass Show(a)',
        '  show(x a) -> String',
        'fn display(x a) where Show(a) = show(x)',
        'fn main() = display(42)',
      ].join('\n'),
    );

    expect(diagnostics.some(d => d.code === 'ARX3006')).toBe(true);
  });

  it('accepts concrete function constraints when matching impl exists', () => {
    const diagnostics = runCheck(
      [
        'typeclass Show(a)',
        '  show(x a) -> String',
        'impl Show for Int',
        '  show(x) = x.toString()',
        'fn display(x a) where Show(a) = show(x)',
        'fn main() = display(42)',
      ].join('\n'),
    );

    expect(diagnostics.some(d => d.code === 'ARX3006')).toBe(false);
  });
});
