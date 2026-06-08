import { describe, it, expect } from 'vitest';
import { transpile } from '../src/transpiler.js';
import { parse } from '../src/parser.js';

function normalizeListValue(value: unknown): unknown {
  if (value && typeof value === 'object' && (value as any)._type === 'Bool') {
    return (value as any)._variant === 'True';
  }

  if (value && typeof value === 'object' && (value as any)._type === 'List') {
    const result: unknown[] = [];
    let current: any = value;
    while (current && current._variant === 'Cons') {
      result.push(normalizeListValue(current.head));
      current = current.tail;
    }
    return result;
  }

  if (Array.isArray(value)) {
    return value.map(v => normalizeListValue(v));
  }

  return value;
}

function evalTranspiled(js: string, mainCall = true): unknown {
  const code = js.replace(/export\s*\{[^}]*\};?/g, '');
  return normalizeListValue(eval(code + (mainCall ? '\nmain()' : '')));
}

describe('Transpiler', () => {
  it('transpiles simple expression', () => {
    const ast = parse('1 + 2');
    const js = transpile(ast);
    const result = eval(js);
    expect(result).toBe(3);
  });

  it('transpiles function call', () => {
    const ast = parse('fn double(x) = x * 2\nfn main() = double(5)');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(10);
  });

  it('transpiles arrow function', () => {
    const ast = parse('fn add(a, b) = a + b\nfn main() = add(3, 4)');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(7);
  });

  it('transpiles async function', () => {
    const ast = parse('async fn fetchVal() = 42\nfn main() = fetchVal()');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result instanceof Promise).toBe(true);
  });

  it('transpiles section operator', () => {
    const ast = parse('fn map(f, xs) = [f(x) for x in xs]\nfn main() = map(* 2, [1, 2, 3])');
    const js = transpile(ast);
    const result = normalizeListValue(eval(js + '\nmain()'));
    expect(result).toEqual([2, 4, 6]);
  });

  it('transpiles record access', () => {
    const ast = parse('fn main() = {x: 10, y: 20}.x');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(10);
  });

  it('transpiles match in context', () => {
    const ast = parse('fn classify(x) = match x: 1 -> "one" 2 -> "two" _ -> "other"\nfn main() = classify(2)');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe('two');
  });

  it('supports implicit params tuple matching inside functions', () => {
    const src = [
      'fn bothTrue(a, b) =',
      '  match params:',
      '    (1, 1) -> 1 == 1',
      '    _ -> 1 == 0',
      'fn bothTrueViaParams(a, b) =',
      '  match params:',
      '    (1, 1) -> 1 == 1',
      '    _ -> 1 == 0',
      'fn main() = (bothTrue(1, 1), bothTrueViaParams(1, 0))',
    ].join('\n');

    const ast = parse(src);
    const js = transpile(ast);
    const result = normalizeListValue(eval(js + '\nmain()'));
    expect(result).toEqual([true, false]);
  });

  it('treats bare nullary constructors as values', () => {
    const src = 'fn main() = True';
    const ast = parse(src);
    const js = transpile(ast);
    expect(js).toContain("typeof True === 'function'");
  });

  it('transpiles for loop', () => {
    const ast = parse('fn main() =\n  for x in [1, 2, 3]:\n    x');
    const js = transpile(ast);
    expect(js).toContain('for');
    expect(js).toContain('of');
  });

  it('transpiles while loop', () => {
    const ast = parse('fn main() =\n  let mut x = 0\n  while x < 5:\n    x = x + 1');
    const js = transpile(ast);
    expect(js).toContain('while');
  });

  it('transpiles break statement', () => {
    const ast = parse('fn main() =\n  for x in [1]:\n    break');
    const js = transpile(ast);
    expect(js).toContain('break');
  });

  it('transpiles continue statement', () => {
    const ast = parse('fn main() =\n  for x in [1]:\n    continue');
    const js = transpile(ast);
    expect(js).toContain('continue');
  });

  it('transpiles list comprehension', () => {
    const ast = parse('fn main() = [x * 2 for x in [1, 2, 3, 4, 5] if x > 2]');
    const js = transpile(ast);
    const result = normalizeListValue(eval(js + '\nmain()'));
    expect(result).toEqual([6, 8, 10]);
  });

  it('transpiles string interpolation', () => {
    const ast = parse('fn main() = "The answer is ${40 + 2}"');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe('The answer is 42');
  });

  it('transpiles block expression', () => {
    const ast = parse('fn main() =\n  let x = 10\n  let y = 5\n  x + y');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(15);
  });

  it('transpiles await expression', () => {
    const ast = parse('async fn main() = await Promise.resolve(42)');
    const js = transpile(ast);
    const resultPromise = eval(js + '\nmain()');
    expect(resultPromise instanceof Promise).toBe(true);
  });

  it('transpiles pipe expression', () => {
    const ast = parse('fn main() = [1, 2, 3] |> length');
    const js = transpile(ast);
    expect(js).toContain('length');
  });

  it('transpiles $ as function application', () => {
    const ast = parse('fn inc(x) = x + 1\nfn main() = inc $ 41');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(42);
  });

  it('transpiles . as function composition', () => {
    const ast = parse('fn f(x) = x + 1\nfn g(x) = x * 2\nfn main() = (f . g)(3)');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(7);
  });

  it('transpiles record literal as statement', () => {
    const ast = parse('fn main() = { x: 10, y: 20 }');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toEqual({ x: 10, y: 20 });
  });

  it('transpiles list literal as statement', () => {
    const ast = parse('fn main() = [1, 2, 3]');
    const js = transpile(ast);
    const result = normalizeListValue(eval(js + '\nmain()'));
    expect(result).toEqual([1, 2, 3]);
  });

  it('transpiles tuple literal as statement', () => {
    const ast = parse('fn main() = (1, 2, 3)');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toEqual([1, 2, 3]);
  });

  it('transpiles index expression as statement', () => {
    const ast = parse('fn main() = [10, 20, 30] !! 1');
    const js = transpile(ast);
    expect(js).toContain('.get(1)');
  });

  it('transpiles unary expression', () => {
    const ast = parse('fn main() = !(1 == 1)');
    const js = transpile(ast);
    const result = normalizeListValue(eval(js + '\nmain()'));
    expect(result).toBe(false);
  });

  it('transpiles let declaration with identifier pattern', () => {
    const ast = parse('fn main() =\n  let x = 10\n  x + 5');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(15);
  });

  it('transpiles let declaration with record pattern', () => {
    const ast = parse('fn main() =\n  let { x, y } = {x: 10, y: 20}\n  x + y');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(30);
  });

  it('transpiles let declaration with list pattern', () => {
    const ast = parse('fn main() =\n  let [a, b, c] = [1, 2, 3]\n  a + b + c');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(6);
  });

  it('transpiles let mut declaration', () => {
    const ast = parse('fn main() =\n  let mut obj = {x: 0}\n  obj');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toEqual({x: 0});
  });

  it('transpiles currying partial application', () => {
    const ast = parse('fn add(a, b, c) = a + b + c\nfn main() = add(10)(20)(30)');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(60);
  });

  it('transpiles binary operators', () => {
    const ast = parse('fn main() = (5 == 5) && (3 != 4) || (2 > 3)');
    const js = transpile(ast);
    const result = normalizeListValue(eval(js + '\nmain()'));
    expect(result).toBe(true);
  });

  it('transpiles string concatenation operator', () => {
    const ast = parse('fn main() = "Hello" ++ " " ++ "World"');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe('Hello World');
  });

  it('transpiles custom ADT type declaration', () => {
    const ast = parse('type Status = Active | Inactive\nfn main() = Status');
    const js = transpile(ast);
    expect(js).toContain('createADT');
    expect(js).toContain('Status');
    expect(js).toContain('Active');
    expect(js).toContain('Inactive');
  });

  it('transpiles ADT with fields', () => {
    const ast = parse('type UserStatus = Active(id) | Inactive(id, reason)\nfn main() = UserStatus');
    const js = transpile(ast);
    expect(js).toContain('createADT');
    expect(js).toContain('UserStatus');
    expect(js).toContain('id');
    expect(js).toContain('reason');
  });

  it('transpiles custom ADT instantiation and pattern matching', () => {
    const code = `type Status = Active | Inactive
fn createStatus() = Status.Active`;
    const ast = parse(code);
    const js = transpile(ast);
    // Verify the transpiled code contains expected ADT elements
    expect(js).toContain('createADT');
    expect(js).toContain('Status');
    expect(js).toContain('Active');
  });

  it('transpiles function with type annotations - primitives', () => {
    const ast = parse('fn add(a Int, b Int) -> Int = a + b\nfn main() = add(5, 3)');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(8);
  });

  it('transpiles function with type annotations - strings', () => {
    const ast = parse('fn greet(name String) -> String = "Hello " ++ name\nfn main() = greet("World")');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe('Hello World');
  });

  it('transpiles function with generic type annotations', () => {
    const ast = parse('fn process(nums List(Int)) -> List(Int) = [x * 2 for x in nums]\nfn main() = process([1, 2, 3])');
    const js = transpile(ast);
    const result = normalizeListValue(eval(js + '\nmain()'));
    expect(result).toEqual([2, 4, 6]);
  });

  it('transpiles multiple parameters with type annotations', () => {
    const ast = parse('fn combine(x Int, y Int, z Int) -> Int = x + y + z\nfn main() = combine(1, 2, 3)');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(6);
  });

  it('transpiles typeclass declaration', () => {
    const src = [
      'typeclass Show(a)',
      '  show(x a) -> String',
      'fn main() = Show',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toBeDefined();
    expect(result.show).toBeNull();
  });

  it('exports typeclass dispatch methods', () => {
    const src = [
      'typeclass Show(a)',
      '  show(x a) -> String',
      'impl Show for Int',
      '  show(x) = x.toString()',
      'fn main() = show(42)',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    expect(js).toMatch(/export \{[^}]*Show[^}]*show[^}]*\};/);
  });

  it('transpiles instance declaration', () => {
    const src = [
      'typeclass Show(a)',
      '  show(x a) -> String',
      'impl Show for Int',
      '  show(x) = x.toString()',
      'fn main() = show(42)',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toBe('42');
  });

  it('routes print through show when Show is available', () => {
    const src = [
      'typeclass Show(a)',
      '  show(x a) -> String',
      'impl Show for Int',
      '  show(x) = x.toString()',
      'fn main() = print(42)',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    expect(js).toContain('print(show(42))');
  });

  it('dispatches typeclass methods by runtime type of the first argument', () => {
    const src = [
      'fn listMap(x, f) = [f(v) for v in x]',
      'typeclass Mapper(a)',
      '  map(x a, f) -> a',
      'impl Mapper for List',
      '  map(x, f) = listMap(x, f)',
      'impl Mapper for String',
      '  map(x, f) = f(x)',
      'fn main() = [map([1, 2, 3], (x) -> x * 2), map("ok", (x) -> x ++ "!")]',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toEqual([[2, 4, 6], 'ok!']);
  });

  it('dispatches flatMap-like methods by runtime type of the first argument', () => {
    const src = [
      'fn append(a, b) =',
      '  match a:',
      '    [] -> b',
      '    [h | t] -> [h | append(t, b)]',
      'fn listFlatMap(x, f) =',
      '  match x:',
      '    [] -> []',
      '    [h | t] -> append(f(h), listFlatMap(t, f))',
      'typeclass Chain(a)',
      '  flatMap(x a, f) -> a',
      'impl Chain for List',
      '  flatMap(x, f) = listFlatMap(x, f)',
      'impl Chain for String',
      '  flatMap(x, f) = f(x)',
      'fn main() = [flatMap([1, 2], (x) -> [x, x + 10]), flatMap("ha", (x) -> x ++ x)]',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toEqual([[1, 11, 2, 12], 'haha']);
  });

  it('throws a runtime error when no instance matches the argument type', () => {
    const src = [
      'typeclass Mapper(a)',
      '  map(x a, f) -> a',
      'impl Mapper for List',
      '  map(x, f) = x',
      'fn main() = map(1 == 1, (x) -> x)',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    expect(() => evalTranspiled(js)).toThrow(/No instance of Mapper found/);
  });

  it('dispatches a typeclass instance declared for ADT to any ADT value', () => {
    const src = [
      'typeclass Show(a)',
      '  show(x a) -> String',
      'impl Show for ADT',
      '  show(x) = x._type ++ ":" ++ x._variant',
      'fn main() = [show({_type: "Status", _variant: "Active"}), show({_type: "Direction", _variant: "North"})]',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toEqual(['Status:Active', 'Direction:North']);
  });

  it('does not match ADT instance dispatch for non-ADT values', () => {
    const src = [
      'typeclass Show(a)',
      '  show(x a) -> String',
      'impl Show for ADT',
      '  show(x) = x._variant',
      'fn main() = show(42)',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    expect(() => evalTranspiled(js)).toThrow(/No instance of Show found/);
  });

  it('formats ADT variants as Variant(args) and nullary variants as Variant', () => {
    const src = [
      'typeclass Show(a)',
      '  show(x a) -> String',
      'impl Show for Int',
      '  show(x) = x.toString()',
      'impl Show for ADT',
      '  show(x) =',
      '    if x._values.length == 0:',
      '      x._variant',
      '    else:',
      '      x._variant ++ "(" ++ x._values.map((v) -> show(v)).join(", ") ++ ")"',
      'fn main() = [show({_type: "Maybe", _variant: "Some", _values: Array.of(3)}), show({_type: "Maybe", _variant: "None", _values: Array.of()})]',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toEqual(['Some(3)', 'None']);
  });

  it('transpiles typeclass with two type parameters', () => {
    const src = [
      'typeclass Convertible(a, b)',
      '  convert(x a) -> b',
      'impl Convertible for (Int, String)',
      '  convert(x) = x.toString()',
      'fn main() = convert(42)',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toBe('42');
  });

  it('transpiles instance with multiple types', () => {
    const src = [
      'typeclass Convertible(a, b)',
      '  convert(x a) -> b',
      'impl Convertible for (String, Int)',
      '  convert(x) = parseInt(x)',
      'fn main() = convert("42")',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toBe(42);
  });

  it('transpiles typeclass with multiple methods', () => {
    const src = [
      'typeclass Eq(a)',
      '  eq(x a, y a) -> Boolean',
      '  notEq(x a, y a) -> Boolean',
      'impl Eq for Int',
      '  eq(x, y) = x == y',
      '  notEq(x, y) = !(x == y)',
      'fn main() = [eq(1, 1), eq(1, 2), notEq(1, 1), notEq(1, 2)]',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toEqual([true, false, false, true]);
  });

  it('transpiles function with where constraint', () => {
    const src = [
      'typeclass Show(a)',
      '  show(x a) -> String',
      'impl Show for Int',
      '  show(x) = x.toString()',
      'fn display(x) where Show(x) = show(x)',
      'fn main() = display(42)',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toBe('42');
  });

  it('transpiles function with multiple constraints', () => {
    const src = [
      'typeclass Eq(a)',
      '  eq(x a, y a) -> Boolean',
      '  notEq(x a, y a) -> Boolean = !(eq(x, y))',
      'typeclass Show(a)',
      '  show(x a) -> String',
      'impl Eq for Int',
      '  eq(x, y) = x == y',
      'impl Show for Int',
      '  show(x) = x.toString()',
      'fn compare(x, y) where Eq(x), Show(x) = notEq(x, y)',
      'fn main() = compare(1, 2)',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toBe(true);
  });

  it('transpiles typeclass with default implementation', () => {
    const src = [
      'typeclass Eq(a)',
      '  eq(x a, y a) -> Boolean',
      '  notEq(x a, y a) -> Boolean = !(eq(x, y))',
      'fn main() = Eq.notEq',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toBeDefined();
  });

  it('transpiles instance inheriting default implementations', () => {
    const src = [
      'typeclass Eq(a)',
      '  eq(x a, y a) -> Boolean',
      '  notEq(x a, y a) -> Boolean = !(eq(x, y))',
      'impl Eq for Int',
      '  eq(x, y) = x == y',
      'fn main() = [eq(1, 1), eq(1, 2), notEq(1, 1), notEq(1, 2)]',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toEqual([true, false, false, true]);
  });

  it('transpiles instance overriding default implementations', () => {
    const src = [
      'typeclass Eq(a)',
      '  eq(x a, y a) -> Boolean',
      '  notEq(x a, y a) -> Boolean = !(eq(x, y))',
      'impl Eq for String',
      '  eq(x, y) = x == y',
      '  notEq(x, y) = !(x == y)',
      'fn main() = [eq("a", "a"), eq("a", "b"), notEq("a", "a"), notEq("a", "b")]',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toEqual([true, false, false, true]);
  });

  it('transpiles multiple typeclasses with different defaults', () => {
    const src = [
      'typeclass Show(a)',
      '  show(x a) -> String',
      'typeclass Eq(a)',
      '  eq(x a, y a) -> Boolean',
      '  notEq(x a, y a) -> Boolean = !(eq(x, y))',
      'impl Eq for Int',
      '  eq(x, y) = x == y',
      'impl Show for Int',
      '  show(x) = x.toString()',
      'fn main() = eq(1, 1)',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toBe(true);
  });

  describe('Anonymous Functions (lambda syntax)', () => {
    it('transpiles single-param lambda', () => {
      const ast = parse([
        'fn main() =',
        '  let f = (x) -> x * 2',
        '  f(5)',
      ].join('\n'));
      const js = transpile(ast);
      const result = eval(js + '\nmain()');
      expect(result).toBe(10);
    });

    it('transpiles lambda passed as argument', () => {
      const ast = parse([
        'fn map(f, xs) = [f(x) for x in xs]',
        'fn main() =',
        '  map((x) -> x * 2, [1, 2, 3])',
      ].join('\n'));
      const js = transpile(ast);
      const result = normalizeListValue(eval(js + '\nmain()'));
      expect(result).toEqual([2, 4, 6]);
    });

    it('transpiles higher-order lambda', () => {
      const ast = parse([
        'fn main() =',
        '  let adder = (n) -> (x) -> x + n',
        '  adder(5)(3)',
      ].join('\n'));
      const js = transpile(ast);
      const result = eval(js + '\nmain()');
      expect(result).toBe(8);
    });

    it('transpiles multi-param lambda', () => {
      const ast = parse([
        'fn main() =',
        '  let f = (a, b) -> a + b',
        '  f(3, 4)',
      ].join('\n'));
      const js = transpile(ast);
      const result = eval(js + '\nmain()');
      expect(result).toBe(7);
    });

    it('transpiles zero-param lambda', () => {
      const ast = parse([
        'fn main() =',
        '  let f = () -> 42',
        '  f()',
      ].join('\n'));
      const js = transpile(ast);
      const result = eval(js + '\nmain()');
      expect(result).toBe(42);
    });
  });
});
