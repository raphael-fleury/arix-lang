import { describe, it, expect, vi } from 'vitest';
import type { Program } from '../src/ast.js';
import { Transpiler, transpile as transpileRaw } from '../src/transpiler.js';
import { parse } from '../src/parser.js';

const TEST_RUNTIME_PREAMBLE = `
function createADT(name, variants) {
  const adt = {
    _name: name,
    _variants: Object.keys(variants)
  };

  for (const [variantName, fields] of Object.entries(variants)) {
    adt[variantName] = (...values) => {
      const instance = {
        _type: name,
        _variant: variantName,
        _values: values
      };

      fields.forEach((field, i) => {
        instance[field] = values[i];
      });

      return Object.freeze(instance);
    };
  }

  adt.match = (value, patterns) => {
    if (!value || value._type !== name) {
      throw new Error(\`Expected \${name}, got \${value?._type || typeof value}\`);
    }

    const variant = value._variant;
    if (!(variant in patterns)) {
      throw new Error(\`Unhandled variant: \${variant}\`);
    }

    const handler = patterns[variant];
    if (typeof handler === 'function') {
      return handler(...value._values);
    }
    return handler;
  };

  adt.isInstance = (value) => {
    return value && value._type === name;
  };

  return adt;
}

const __op_toJsBool = (v) => {
  if (v && typeof v === 'object' && v._type === 'Bool') {
    return v._variant === 'True';
  }
  return Boolean(v);
};

const __op_eq = (a, b) => {
  if (a && b && typeof a === 'object' && typeof b === 'object' && a._type === 'Bool' && b._type === 'Bool') {
    return a._variant === b._variant;
  }
  return a === b;
};

const __op_notEq = (a, b) => !__op_eq(a, b);
const __op_add = (a, b) => a + b;
const __op_sub = (a, b) => (typeof b === 'undefined' ? -a : a - b);
const __op_mul = (a, b) => a * b;
const __op_div = (a, b) => a / b;
const __op_lt = (a, b) => a < b;
const __op_gt = (a, b) => a > b;
const __op_lte = (a, b) => a <= b;
const __op_gte = (a, b) => a >= b;
const __op_and = (a, b) => __op_toJsBool(a) && __op_toJsBool(b);
const __op_or = (a, b) => __op_toJsBool(a) || __op_toJsBool(b);
const __op_not = (a) => !__op_toJsBool(a);
const __op_apply = (f, x) => f(x);
const __op_compose = (f, g) => (x) => f(g(x));
const __op_pipe = (x, f) => f(x);

const __op_append = (a, b) => {
  if (typeof a === 'string' && typeof b === 'string') {
    return a + b;
  }

  const isList = (v) => v && typeof v === 'object' && v._type === 'List';
  if (isList(a) && isList(b)) {
    if (a._variant === 'Nil') {
      return b;
    }
    return { _type: 'List', _variant: 'Cons', _values: [a.head, __op_append(a.tail, b)], head: a.head, tail: __op_append(a.tail, b) };
  }

  return String(a) + String(b);
};

const __jsBase = {
  EQ: (a, b) => a === b,
  NE: (a, b) => a !== b,
  LT: (a, b) => a < b,
  GT: (a, b) => a > b,
  LTE: (a, b) => a <= b,
  GTE: (a, b) => a >= b,
  ADD: (a, b) => a + b,
  SUB: (a, b) => a - b,
  MUL: (a, b) => a * b,
  DIV: (a, b) => a / b,
  MOD: (a, b) => a % b,
  POW: (a, b) => a ** b,
  AND: (a, b) => a && b,
  OR: (a, b) => a || b,
  NOT: (a) => !a,
  BAND: (a, b) => a & b,
  BOR: (a, b) => a | b,
  BXOR: (a, b) => a ^ b,
  BNOT: (a) => ~a,
  LSHIFT: (a, b) => a << b,
  RSHIFT: (a, b) => a >> b,
  URSHIFT: (a, b) => a >>> b,
};

const js = new Proxy(__jsBase, {
  get(target, prop) {
    if (prop in target) {
      return target[prop];
    }
    return globalThis[prop];
  }
});
`;

const TEST_OPERATOR_FNS = new Map<string, string>([
  ['+', '__op_add'],
  ['-', '__op_sub'],
  ['*', '__op_mul'],
  ['/', '__op_div'],
  ['==', '__op_eq'],
  ['!=', '__op_notEq'],
  ['<', '__op_lt'],
  ['>', '__op_gt'],
  ['<=', '__op_lte'],
  ['>=', '__op_gte'],
  ['&&', '__op_and'],
  ['||', '__op_or'],
  ['!', '__op_not'],
  ['++', '__op_append'],
  ['$', '__op_apply'],
  ['.', '__op_compose'],
  ['|>', '__op_pipe'],
]);

function transpile(ast: Program): string {
  const transpiler = new Transpiler();
  transpiler.setOperatorFns(new Map(TEST_OPERATOR_FNS));
  const output = transpiler.transpile(ast);

  const cleaned = output
    .replace(/^import\s+.*$/gm, '')
    .replace(/\bexport\s+(function|const)\s/g, '$1 ')
    .replace(/export\s*\{[^}]*\};?/g, '')
    .trim();

  const needsRuntimePreamble = /\bcreateADT\b|\bjs\.|__op_/.test(cleaned);
  if (!needsRuntimePreamble) {
    return `${cleaned}\n`;
  }

  return `${TEST_RUNTIME_PREAMBLE}\n${cleaned}\n`;
}

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
  it('transpiles decorators as function metadata', () => {
    const src = [
      '@Test',
      '@Operator("**", "infixl", 7)',
      'fn pow(a, b) = a ** b',
      'fn main() = pow._decorators.length',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(1);
    expect(js).not.toContain('"Operator"');
  });

  it('applies @Deprecated built-in decorator behavior', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const src = [
        '@Deprecated("Use divideSafe")',
        'fn divide(a, b) = a / b',
        'fn main() = divide(4, 2)',
      ].join('\n');
      const ast = parse(src);
      const js = transpile(ast);
      const result = eval(js + '\nmain()');
      expect(result).toBe(2);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain('Use divideSafe');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('applies @Memo built-in decorator behavior', () => {
    const src = [
      '@Memo',
      'fn roll(seed) = js.Math.random()',
      'fn main() =',
      '  let first = roll(7)',
      '  let second = roll(7)',
      '  first == second',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = normalizeListValue(eval(js + '\nmain()'));
    expect(result).toBe(true);
  });

  it('transpiles simple expression', () => {
    const ast = parse('1 + 2');
    const js = transpile(ast);
    const result = eval(js);
    expect(result).toBe(3);
  });

  it('transpiles function call', () => {
    const src = [
      'fn double(x) = x * 2',
      'fn main() = double(5)',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(10);
  });

  it('transpiles arrow function', () => {
    const src = [
      'fn add(a, b) = a + b',
      'fn main() = add(3, 4)',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(7);
  });

  it('transpiles async function', () => {
    const src = [
      'async fn fetchVal() = 42',
      'fn main() = fetchVal()',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result instanceof Promise).toBe(true);
  });

  it('transpiles section operator', () => {
    const src = [
      'fn map(f, xs) = [f(x) for x in xs]',
      'fn main() = map(* 2, [1, 2, 3])',
    ].join('\n');
    const ast = parse(src);
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
    const src = [
      'fn classify(x) = match x: 1 -> "one" 2 -> "two" _ -> "other"',
      'fn main() = classify(2)',
    ].join('\n');
    const ast = parse(src);
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

  it('transpiles bare nullary constructors', () => {
    const src = [
      'type Flag = On | Off',
      'fn main() = On',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    expect(js).toContain('Flag.On()');
  });

  it('transpiles for loop', () => {
    const src = [
      'fn main() =',
      '  for x in [1, 2, 3]:',
      '    x',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    expect(js).toContain('for');
    expect(js).toContain('of');
  });

  it('transpiles while loop', () => {
    const src = [
      'fn main() =',
      '  let mut x = 0',
      '  while x < 5:',
      '    x = x + 1',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    expect(js).toContain('while');
  });

  it('transpiles break statement', () => {
    const src = [
      'fn main() =',
      '  for x in [1]:',
      '    break',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    expect(js).toContain('break');
  });

  it('transpiles continue statement', () => {
    const src = [
      'fn main() =',
      '  for x in [1]:',
      '    continue',
    ].join('\n');
    const ast = parse(src);
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
    const src = [
      'fn main() =',
      '  let x = 10',
      '  let y = 5',
      '  x + y',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(15);
  });

  it('transpiles await expression', () => {
    const ast = parse('async fn main() = await js.Promise.resolve(42)');
    const js = transpile(ast);
    const resultPromise = eval(js + '\nmain()');
    expect(resultPromise instanceof Promise).toBe(true);
  });

  it('rejects implicit JavaScript global access without js namespace', () => {
    const ast = parse('fn main() = parseInt("42")');
    expect(() => transpile(ast)).toThrow(/Use js\.parseInt for JavaScript interop/);
  });

  it('allows JavaScript global access through js namespace', () => {
    const ast = parse('fn main() = js.parseInt("42")');
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(42);
  });

  it('rejects reserved js namespace redeclaration', () => {
    const ast = parse('fn main(js) = js');
    expect(() => transpile(ast)).toThrow(/reserved namespace/);
  });

  it('transpiles pipe expression', () => {
    const src = [
      'fn length(xs) = 3',
      'fn main() = [1, 2, 3] |> length',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    expect(js).toContain('length');
  });

  it('transpiles $ as function application', () => {
    const src = [
      'fn inc(x) = x + 1',
      'fn main() = inc $ 41',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(42);
  });

  it('transpiles . as function composition', () => {
    const src = [
      'fn f(x) = x + 1',
      'fn g(x) = x * 2',
      'fn main() = (f . g)(3)',
    ].join('\n');
    const ast = parse(src);
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
    const src = [
      'fn main() =',
      '  let x = 10',
      '  x + 5',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(15);
  });

  it('transpiles let declaration with record pattern', () => {
    const src = [
      'fn main() =',
      '  let { x, y } = {x: 10, y: 20}',
      '  x + y',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(30);
  });

  it('transpiles let declaration with list pattern', () => {
    const src = [
      'fn main() =',
      '  let [a, b, c] = [1, 2, 3]',
      '  a + b + c',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(6);
  });

  it('transpiles let mut declaration', () => {
    const src = [
      'fn main() =',
      '  let mut obj = {x: 0}',
      '  obj',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toEqual({x: 0});
  });

  it('transpiles currying partial application', () => {
    const src = [
      'fn add(a, b, c) = a + b + c',
      'fn main() = add(10)(20)(30)',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(60);
  });

  it('transpiles binary operators', () => {
    const transpiler = new Transpiler();
    transpiler.setOperatorFns(new Map<string, string>([
      ['==', 'eq'],
      ['!=', 'notEq'],
      ['>', 'gt'],
      ['&&', 'and'],
      ['||', 'or'],
    ]));
    const js = transpiler.transpile(parse('fn main() = (5 == 5) && (3 != 4) || (2 > 3)'), 'binary-ops-test.arix');

    expect(js).toContain('eq(5, 5)');
    expect(js).toContain('notEq(3, 4)');
    expect(js).toContain('gt(2, 3)');
    expect(js).toContain('and(');
    expect(js).toContain('or(');
  });

  it('transpiles string concatenation operator', () => {
    const transpiler = new Transpiler();
    transpiler.setOperatorFns(new Map<string, string>([['++', 'append']]));
    const js = transpiler.transpile(parse('fn main() = "Hello" ++ " " ++ "World"'), 'concat-ops-test.arix');

    expect(js).toContain('append("Hello", " ")');
    expect(js).toContain('append(append("Hello", " "), "World")');
  });

  it('transpiles custom ADT type declaration', () => {
    const src = [
      'type Status = Active | Inactive',
      'fn main() = Status',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    expect(js).toContain('createADT');
    expect(js).toContain('Status');
    expect(js).toContain('Active');
    expect(js).toContain('Inactive');
  });

  it('transpiles ADT with fields', () => {
    const src = [
      'type UserStatus = Active(id) | Inactive(id, reason)',
      'fn main() = UserStatus',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    expect(js).toContain('createADT');
    expect(js).toContain('UserStatus');
    expect(js).toContain('id');
    expect(js).toContain('reason');
  });

  it('transpiles record type declaration', () => {
    const src = [
      'type User = { name String, age Int ?? 18 }',
      'fn main() = User',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);

    expect(js).toContain('const User = {');
    expect(js).toContain('name: String');
    expect(js).toContain('age: Int = 18');
    expect(js).not.toContain('createADT');
  });

  it('transpiles custom ADT instantiation and pattern matching', () => {
    const src = [
      'type Status = Active | Inactive',
      'fn createStatus() = Status.Active',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    // Verify the transpiled code contains expected ADT elements
    expect(js).toContain('createADT');
    expect(js).toContain('Status');
    expect(js).toContain('Active');
  });

  it('transpiles function with type annotations - primitives', () => {
    const src = [
      'fn add(a Int, b Int) -> Int = a + b',
      'fn main() = add(5, 3)',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe(8);
  });

  it('transpiles function with type annotations - strings', () => {
    const src = [
      'fn greet(name String) -> String = "Hello " ++ name',
      'fn main() = greet("World")',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = eval(js + '\nmain()');
    expect(result).toBe('Hello World');
  });

  it('transpiles function with generic type annotations', () => {
    const src = [
      'fn process(nums List(Int)) -> List(Int) = [x * 2 for x in nums]',
      'fn main() = process([1, 2, 3])',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = normalizeListValue(eval(js + '\nmain()'));
    expect(result).toEqual([2, 4, 6]);
  });

  it('transpiles multiple parameters with type annotations', () => {
    const src = [
      'fn combine(x Int, y Int, z Int) -> Int = x + y + z',
      'fn main() = combine(1, 2, 3)',
    ].join('\n');
    const ast = parse(src);
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
    const result = evalTranspiled(js) as any;
    expect(result).toBeDefined();
    expect(result.show).toBeNull();
  });

  it('registers @Operator from typeclass methods', () => {
    const src = [
      'typeclass Eq(a)',
      '  @Operator("==", "infix", 4)',
      '  eq(x a, y a) -> Bool',
      'fn main() = 1 == 1',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);

    expect(js).toContain('eq(1, 1)');
  });

  it('applies decorators on typeclass default methods', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const src = [
        'typeclass Show(a)',
        '  @Deprecated("Use display")',
        '  show(x a) -> String = x',
        'fn main() = Show.show("hello")',
      ].join('\n');
      const ast = parse(src);
      const js = transpile(ast);
      const result = evalTranspiled(js);
      expect(result).toBe('hello');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain('Use display');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('applies decorators on impl methods', () => {
    const src = [
      'typeclass Roll(a)',
      '  roll(x a) -> Float',
      'impl Roll for Int',
      '  @Memo',
      '  roll(x) = js.Math.random()',
      'fn main() =',
      '  let first = roll(7)',
      '  let second = roll(7)',
      '  first == second',
    ].join('\n');
    const ast = parse(src);
    const js = transpile(ast);
    const result = evalTranspiled(js);
    expect(result).toBe(true);
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
    const js = transpileRaw(ast);
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
      'fn main() = [show({_type: "Maybe", _variant: "Some", _values: js.Array.of(3)}), show({_type: "Maybe", _variant: "None", _values: js.Array.of()})]',
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
      '  convert(x) = js.parseInt(x)',
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
      const src = [
        'fn main() =',
        '  let f = (x) -> x * 2',
        '  f(5)',
      ].join('\n');
      const ast = parse(src);
      const js = transpile(ast);
      const result = eval(js + '\nmain()');
      expect(result).toBe(10);
    });

    it('transpiles lambda passed as argument', () => {
      const src = [
        'fn map(f, xs) = [f(x) for x in xs]',
        'fn main() =',
        '  map((x) -> x * 2, [1, 2, 3])',
      ].join('\n');
      const ast = parse(src);
      const js = transpile(ast);
      const result = normalizeListValue(eval(js + '\nmain()'));
      expect(result).toEqual([2, 4, 6]);
    });

    it('transpiles higher-order lambda', () => {
      const src = [
        'fn main() =',
        '  let adder = (n) -> (x) -> x + n',
        '  adder(5)(3)',
      ].join('\n');
      const ast = parse(src);
      const js = transpile(ast);
      const result = eval(js + '\nmain()');
      expect(result).toBe(8);
    });

    it('transpiles multi-param lambda', () => {
      const src = [
        'fn main() =',
        '  let f = (a, b) -> a + b',
        '  f(3, 4)',
      ].join('\n');
      const ast = parse(src);
      const js = transpile(ast);
      const result = eval(js + '\nmain()');
      expect(result).toBe(7);
    });

    it('transpiles zero-param lambda', () => {
      const src = [
        'fn main() =',
        '  let f = () -> 42',
        '  f()',
      ].join('\n');
      const ast = parse(src);
      const js = transpile(ast);
      const result = eval(js + '\nmain()');
      expect(result).toBe(42);
    });
  });
});
