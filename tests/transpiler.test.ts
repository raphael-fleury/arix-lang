import { describe, it, expect } from 'vitest';
import { transpile } from '../src/transpiler.js';
import { parse } from '../src/parser.js';

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
    const ast = parse('fn main() = [1, 2, 3].map(* 2)');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
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
    const result = eval(js + '\nmain()');
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

  it('transpiles record literal as statement', () => {
    const ast = parse('fn main() = { x: 10, y: 20 }');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toEqual({ x: 10, y: 20 });
  });

  it('transpiles list literal as statement', () => {
    const ast = parse('fn main() = [1, 2, 3]');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
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
    const ast = parse('fn main() = !true');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
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
    const result = eval(js + '\nmain()');
    expect(result).toBe(true);
  });

  it('transpiles string concatenation operator', () => {
    const ast = parse('fn main() = "Hello" ++ " " ++ "World"');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe('Hello World');
  });
});
