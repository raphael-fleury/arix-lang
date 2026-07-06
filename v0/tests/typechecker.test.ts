import { describe, expect, it } from 'vitest'
import { desugar } from '../src/desugar.js'
import { parse } from '../src/parser.js'
import { TypeChecker } from '../src/typechecker.js'
import { compileSourceToC } from '../src/index.js'

describe('typechecker', () => {
  it('accepts a valid let-bound lambda program', () => {
    const program = desugar(parse(`
      enum Maybe<T> { Just(T), Nothing }
      let unwrap: (Maybe<Int>) => Int = (value) => match value {
        Just(item) => item;
        Nothing => 0;
      };
    `))

    const diagnostics = new TypeChecker().check(program, 'test.arix')
    expect(diagnostics).toHaveLength(0)
  })

  it('accepts typeclass and implementation declarations', () => {
    const program = desugar(parse(`
      typeclass Eq<T> {
        equal: (T, T) => Bool;
        notEqual: (T, T) => Bool = (a, b) => False;
      }

      implementation Eq<T> {
        equal = (a, b) => True;
      }
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass.arix')
    expect(diagnostics).toHaveLength(0)
  })

  it('rejects implementations missing required methods', () => {
    const program = desugar(parse(`
      typeclass Eq<T> {
        equal: (T, T) => Bool;
        notEqual: (T, T) => Bool = (a, b) => False;
      }

      implementation Eq<T> {
      }
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass-missing.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2010')).toBe(true)
  })

  it('rejects implementation methods not present in typeclass', () => {
    const program = desugar(parse(`
      typeclass Eq<T> {
        equal: (T, T) => Bool;
      }

      implementation Eq<T> {
        equal = (a, b) => True;
        compare = (a, b) => True;
      }
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass-extra.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2011')).toBe(true)
  })

  it('rejects default method arity mismatch with declared signature', () => {
    const program = desugar(parse(`
      typeclass Eq<T> {
        equal: (T, T) => Bool = (a) => True;
      }

      implementation Eq<T> {
        equal = (a, b) => True;
      }
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass-default-arity.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2013')).toBe(true)
  })

  it('rejects implementation arity mismatch with declared signature', () => {
    const program = desugar(parse(`
      typeclass Eq<T> {
        equal: (T, T) => Bool;
      }

      implementation Eq<T> {
        equal = (a) => True;
      }
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass-impl-arity.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2014')).toBe(true)
  })

  it('rejects implementation typed parameter mismatch against instantiated signature', () => {
    const program = desugar(parse(`
      typeclass Eq<T> {
        equal: (T, T) => Bool;
      }

      implementation Eq<Int> {
        equal = (a: String, b: String): Bool => True;
      }
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass-impl-types.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2016')).toBe(true)
  })

  it('rejects default method typed signature mismatch', () => {
    const program = desugar(parse(`
      typeclass Eq<T> {
        equal: (T, T) => Bool = (a: String, b: String): Bool => True;
      }

      implementation Eq<Int> {
        equal = (a, b) => True;
      }
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass-default-types.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2015')).toBe(true)
  })

  it('rejects unknown where constraints in typeclass declarations', () => {
    const program = desugar(parse(`
      typeclass Eq<T> where Ord<T> {
        equal: (T, T) => Bool;
      }

      implementation Eq<Int> {
        equal = (a, b) => True;
      }
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass-constraint-unknown.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2017')).toBe(true)
  })

  it('rejects where constraints with wrong type argument arity', () => {
    const program = desugar(parse(`
      typeclass Ord<T> {
        compare: (T, T) => Int;
      }

      typeclass Eq<T> where Ord<T, T> {
        equal: (T, T) => Bool;
      }

      implementation Eq<Int> {
        equal = (a, b) => True;
      }
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass-constraint-arity.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2018')).toBe(true)
  })

  it('rejects generic calls without matching implementation type arguments', () => {
    const program = desugar(parse(`
      typeclass Eq<T> {
        equal: (T, T) => Bool;
      }

      implementation Eq<Int> {
        equal = (a, b) => True;
      }

      let main: () => Bool = () => equal<String>('a', 'b');
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass-generic-dispatch.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2022')).toBe(true)
  })

  it('rejects ambiguous generic method calls across typeclasses', () => {
    const program = desugar(parse(`
      typeclass Eq<T> {
        same: (T, T) => Bool;
      }

      typeclass Comparable<T> {
        same: (T, T) => Bool;
      }

      implementation Eq<Int> {
        same = (a, b) => True;
      }

      implementation Comparable<Int> {
        same = (a, b) => True;
      }

      let main: () => Bool = () => same<Int>(1, 2);
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass-generic-ambiguous.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2020')).toBe(true)
  })

  it('rejects generic calls when where constraints are not satisfied', () => {
    const program = desugar(parse(`
      typeclass Ord<T> {
        compare: (T, T) => Int;
      }

      typeclass Sortable<T> where Ord<T> {
        sort: (Array<T>) => Array<T>;
      }

      implementation Sortable<Int> {
        sort = (values) => values;
      }

      let main: () => Array<Int> = () => sort<Int>([1, 2]);
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass-where-unsatisfied.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2023')).toBe(true)
  })

  it('accepts generic calls when transitive where constraints are satisfied', () => {
    const program = desugar(parse(`
      typeclass Show<T> {
        show: (T) => Array<Char>;
      }

      typeclass Ord<T> where Show<T> {
        compare: (T, T) => Int;
      }

      typeclass Sortable<T> where Ord<T> {
        sort: (Array<T>) => Array<T>;
      }

      implementation Show<Int> {
        show = (value) => ['1'];
      }

      implementation Ord<Int> {
        compare = (a, b) => 0;
      }

      implementation Sortable<Int> {
        sort = (values) => values;
      }

      let main: () => Array<Int> = () => sort<Int>([1, 2]);
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass-where-transitive-ok.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2023')).toBe(false)
  })

  it('rejects concrete implementation when where constraints are not satisfied', () => {
    const program = desugar(parse(`
      typeclass Ord<T> {
        compare: (T, T) => Int;
      }

      typeclass Sortable<T> where Ord<T> {
        sort: (Array<T>) => Array<T>;
      }

      implementation Sortable<Int> {
        sort = (values) => values;
      }
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass-impl-where-unsatisfied.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2024')).toBe(true)
  })

  it('accepts concrete implementation when transitive where constraints are satisfied', () => {
    const program = desugar(parse(`
      typeclass Show<T> {
        show: (T) => Array<Char>;
      }

      typeclass Ord<T> where Show<T> {
        compare: (T, T) => Int;
      }

      typeclass Sortable<T> where Ord<T> {
        sort: (Array<T>) => Array<T>;
      }

      implementation Show<Int> {
        show = (value) => ['1'];
      }

      implementation Ord<Int> {
        compare = (a, b) => 0;
      }

      implementation Sortable<Int> {
        sort = (values) => values;
      }
    `))

    const diagnostics = new TypeChecker().check(program, 'typeclass-impl-where-transitive-ok.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2024')).toBe(false)
  })

  it('rejects let declarations with incompatible declared type', () => {
    const program = desugar(parse(`
      let name: Int = 'a';
    `))

    const diagnostics = new TypeChecker().check(program, 'let-type-mismatch.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2028')).toBe(true)
  })

  it('rejects calls with incompatible argument types', () => {
    const program = desugar(parse(`
      let add: (Int, Int) => Int = (a, b) => a;
      let main: () => Int = () => add('a', 1);
    `))

    const diagnostics = new TypeChecker().check(program, 'call-arg-mismatch.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2026')).toBe(true)
  })

  it('rejects functions with incompatible return type', () => {
    const program = desugar(parse(`
      let main: () => Int = () => 'a';
    `))

    const diagnostics = new TypeChecker().check(program, 'return-type-mismatch.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2027')).toBe(true)
  })

  it('accepts typed let, call and return flow', () => {
    const program = desugar(parse(`
      let id: (Int) => Int = (x) => x;
      let main: () => Int = () => {
        let value: Int = id(1);
        return value;
      };
    `))

    const diagnostics = new TypeChecker().check(program, 'typed-flow-ok.arix')
    expect(diagnostics.some(diag => ['ARX2025', 'ARX2026', 'ARX2027', 'ARX2028'].includes(diag.code))).toBe(false)
  })

  it('accepts generic call with call-site type argument substitution', () => {
    const program = desugar(parse(`
      let id: (T) => T = (x) => x;
      let main: () => Int = () => id<Int>(1);
    `))

    const diagnostics = new TypeChecker().check(program, 'generic-substitution-ok.arix')
    expect(diagnostics.some(diag => ['ARX2026', 'ARX2027', 'ARX2029'].includes(diag.code))).toBe(false)
  })

  it('rejects generic call argument mismatch after substitution', () => {
    const program = desugar(parse(`
      let id: (T) => T = (x) => x;
      let main: () => Int = () => id<Int>('a');
    `))

    const diagnostics = new TypeChecker().check(program, 'generic-substitution-arg-mismatch.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2026')).toBe(true)
  })

  it('rejects generic call with wrong generic arity for known function signature', () => {
    const program = desugar(parse(`
      let id: (T) => T = (x) => x;
      let main: () => Int = () => id<Int, String>(1);
    `))

    const diagnostics = new TypeChecker().check(program, 'generic-arity-mismatch.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2029')).toBe(true)
  })

  it('infers generic type arguments from call arguments when omitted', () => {
    const program = desugar(parse(`
      let id: (T) => T = (x) => x;
      let main: () => Int = () => id(1);
    `))

    const diagnostics = new TypeChecker().check(program, 'generic-infer-ok.arix')
    expect(diagnostics.some(diag => ['ARX2026', 'ARX2027', 'ARX2032'].includes(diag.code))).toBe(false)
  })

  it('rejects generic inference with inconsistent argument types', () => {
    const program = desugar(parse(`
      let same: (T, T) => T = (a, b) => a;
      let main: () => Int = () => same(1, 'a');
    `))

    const diagnostics = new TypeChecker().check(program, 'generic-infer-conflict.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2032')).toBe(true)
  })

  it('infers generics through function-typed arguments', () => {
    const program = desugar(parse(`
      let apply: ((T) => U, T) => U = (fn, value) => fn(value);
      let inc: (Int) => Int = (x) => x;
      let main: () => Int = () => apply(inc, 1);
    `))

    const diagnostics = new TypeChecker().check(program, 'generic-infer-function-param.arix')
    expect(diagnostics.some(diag => ['ARX2026', 'ARX2027', 'ARX2032'].includes(diag.code))).toBe(false)
  })

  it('rejects inconsistent nested generic inference', () => {
    const program = desugar(parse(`
      let merge: (Array<T>, Array<T>) => Array<T> = (a, b) => a;
      let main: () => Array<Int> = () => merge([1], ['a']);
    `))

    const diagnostics = new TypeChecker().check(program, 'generic-infer-nested-conflict.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2032')).toBe(true)
  })

  it('accepts exhaustive match covering all enum variants', () => {
    const program = desugar(parse(`
      enum Maybe<T> { Just(T), Nothing }
      let main: () => Int = (value) => match value {
        Just(x) => 1;
        Nothing => 0;
      };
    `))

    const diagnostics = new TypeChecker().check(program, 'match-exhaustive-ok.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2033')).toBe(false)
  })

  it('rejects non-exhaustive match missing a variant', () => {
    const program = desugar(parse(`
      enum Maybe<T> { Just(T), Nothing }
      let main: () => Int = (value) => match value {
        Just(x) => 1;
      };
    `))

    const diagnostics = new TypeChecker().check(program, 'match-non-exhaustive.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2033')).toBe(true)
  })

  it('accepts match with wildcard as catch-all (no exhaustiveness error)', () => {
    const program = desugar(parse(`
      enum Color { Red, Green, Blue }
      let main: () => Int = (value) => match value {
        Red => 1;
        _ => 0;
      };
    `))

    const diagnostics = new TypeChecker().check(program, 'match-wildcard-ok.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2033')).toBe(false)
  })

  it('rejects unreachable arm after wildcard', () => {
    const program = desugar(parse(`
      enum Color { Red, Green, Blue }
      let main: () => Int = (value) => match value {
        _ => 0;
        Red => 1;
      };
    `))

    const diagnostics = new TypeChecker().check(program, 'match-unreachable-after-wildcard.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2034')).toBe(true)
  })

  it('rejects duplicate constructor pattern', () => {
    const program = desugar(parse(`
      enum Color { Red, Green, Blue }
      let main: () => Int = (value) => match value {
        Red => 1;
        Red => 2;
        Green => 3;
        Blue => 4;
      };
    `))

    const diagnostics = new TypeChecker().check(program, 'match-duplicate-arm.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2034')).toBe(true)
  })

  it('does not treat guarded constructor arm as fully covering variant for exhaustiveness', () => {
    const program = desugar(parse(`
      enum Maybe<T> { Just(T), Nothing }
      let main: () => Int = (value) => match value {
        Just(x) when True => 1;
        Nothing => 0;
      };
    `))

    const diagnostics = new TypeChecker().check(program, 'match-guarded-nonexhaustive.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2033')).toBe(true)
  })

  it('does not mark duplicate constructor as unreachable when first arm is guarded', () => {
    const program = desugar(parse(`
      enum Color { Red, Green }
      let main: () => Int = (value) => match value {
        Red when True => 1;
        Red => 2;
        Green => 3;
      };
    `))

    const diagnostics = new TypeChecker().check(program, 'match-guarded-duplicate-allowed.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2034')).toBe(false)
  })

  it('does not treat guarded wildcard as catch-all for unreachable analysis', () => {
    const program = desugar(parse(`
      enum Color { Red, Green }
      let main: () => Int = (value) => match value {
        _ when True => 0;
        Red => 1;
        Green => 2;
      };
    `))

    const diagnostics = new TypeChecker().check(program, 'match-guarded-wildcard-not-catchall.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2034')).toBe(false)
  })

  it('infers enum type from constructor expression', () => {
    const program = desugar(parse(`
      enum Maybe<T> { Just(T), Nothing }
      let x: Maybe<Int> = Just(1);
    `))

    const diagnostics = new TypeChecker().check(program, 'constructor-type-ok.arix')
    expect(diagnostics.some(diag => ['ARX2028', 'ARX2035', 'ARX2036'].includes(diag.code))).toBe(false)
  })

  it('rejects constructor call with wrong argument count', () => {
    const program = desugar(parse(`
      enum Maybe<T> { Just(T), Nothing }
      let x = Just(1, 2);
    `))

    const diagnostics = new TypeChecker().check(program, 'constructor-arity.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2035')).toBe(true)
  })

  it('rejects constructor call with incompatible argument type', () => {
    const program = desugar(parse(`
      enum Box { Wrap(Int) }
      let x: Box = Wrap('a');
    `))

    const diagnostics = new TypeChecker().check(program, 'constructor-arg-type.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2036')).toBe(true)
  })

  it('rejects let binding with mismatched constructor type', () => {
    const program = desugar(parse(`
      enum Maybe<T> { Just(T), Nothing }
      enum Color { Red }
      let x: Color = Just(1);
    `))

    const diagnostics = new TypeChecker().check(program, 'constructor-type-mismatch.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2028')).toBe(true)
  })

  it('infers type var from first arg and validates second arg against inferred binding', () => {
    const program = desugar(parse(`
      let pair: (T, T) => T = (a, b) => a;
      let main: () => Int = () => pair(1, 'a');
    `))

    const diagnostics = new TypeChecker().check(program, 'infer-incremental-conflict.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2032')).toBe(true)
  })

  it('accepts call where type var in later param matches binding from first param', () => {
    const program = desugar(parse(`
      let pair: (T, T) => T = (a, b) => a;
      let main: () => Int = () => pair(1, 2);
    `))

    const diagnostics = new TypeChecker().check(program, 'infer-incremental-ok.arix')
    expect(diagnostics.some(diag => ['ARX2026', 'ARX2027', 'ARX2032'].includes(diag.code))).toBe(false)
  })

  it('does not error on unknown args when inferring generics (partial application context)', () => {
    const program = desugar(parse(`
      let id: (T) => T = (x) => x;
      let main: () => Int = () => id(1);
    `))

    const diagnostics = new TypeChecker().check(program, 'infer-unknown-ok.arix')
    expect(diagnostics.some(diag => ['ARX2026', 'ARX2032'].includes(diag.code))).toBe(false)
  })

  it('treats structural mismatch between TypeRef and FunctionType as non-fatal in inference', () => {
    const program = desugar(parse(`
      let call: ((T) => T, T) => T = (fn, x) => fn(x);
      let id: (Int) => Int = (x) => x;
      let main: () => Int = () => call(id, 1);
    `))

    const diagnostics = new TypeChecker().check(program, 'infer-structural-ok.arix')
    expect(diagnostics.some(diag => diag.code === 'ARX2032')).toBe(false)
  })

  it('accepts IO-annotated impure functions with builtin calls', () => {
    const program = desugar(parse(`
      let main: () => IO<Unit> = () => {
        printLine("hello");
        let xs: Array<Int> = [1, 2, 3];
        let n: Int = arrayLength(xs);
        let first: Int = arrayGet(xs, 0);
        print(add(n, first));
      };
    `))

    const diagnostics = new TypeChecker().check(program, 'io-builtins.arix')
    expect(diagnostics).toHaveLength(0)
  })

})

describe('module resolution', () => {
  it('resolves imported module and makes its declarations available', () => {
    const mathSource = `
      module Math;
      let add: (Int, Int) => Int = (a, b) => a;
    `
    const resolver = (path: string) => path.endsWith('math.arix') ? mathSource : undefined

    const result = compileSourceToC(`
      import math;
      let main: () => Int = () => add(1, 2);
    `, 'main.arix', resolver)

    expect(result.diagnostics).toHaveLength(0)
  })

  it('does not error when imported file is not found (graceful skip)', () => {
    const result = compileSourceToC(`
      import missing;
      let main: () => Int = () => 1;
    `, 'main.arix', () => undefined)

    expect(result.diagnostics).toHaveLength(0)
  })

  it('handles circular imports without infinite loop', () => {
    const aSource = `module A; import b; let x: Int = 1;`
    const bSource = `module B; import a; let y: Int = 2;`
    const resolver = (path: string) => {
      if (path.endsWith('b.arix')) return bSource
      if (path.endsWith('a.arix')) return aSource
      return undefined
    }

    const result = compileSourceToC(`
      import a;
      let main: () => Int = () => 1;
    `, 'main.arix', resolver)

    expect(result.diagnostics).toHaveLength(0)
  })

  it('makes enum from imported module available in typechecker', () => {
    const typesSource = `
      module Types;
      enum Color { Red, Green, Blue }
    `
    const resolver = (path: string) => path.endsWith('types.arix') ? typesSource : undefined

    const result = compileSourceToC(`
      import types;
      let main: () => Int = (c) => match c {
        Red => 1;
        Green => 2;
        Blue => 3;
      };
    `, 'main.arix', resolver)

    expect(result.diagnostics).toHaveLength(0)
  })
})