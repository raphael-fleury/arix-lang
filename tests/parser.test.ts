import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';

describe('Parser', () => {
  it('parses function declaration', () => {
    const ast = parse('fn add(a, b) = a + b');
    expect(ast.body[0].type).toBe('FunctionDecl');
    expect((ast.body[0] as any).name).toBe('add');
  });

  it('parses async function', () => {
    const ast = parse('async fn fetch() = 1');
    expect(ast.body[0].type).toBe('FunctionDecl');
    expect((ast.body[0] as any).isAsync).toBe(true);
  });

  it('parses let declaration', () => {
    const ast = parse('let x = 1');
    expect(ast.body[0].type).toBe('LetDecl');
  });

  it('parses match expression with when', () => {
    const ast = parse('match x: n when n > 5 -> 1 _ -> 0');
    expect(ast.body[0].type).toBe('MatchExpr');
  });

  it('parses match arms with constructor patterns and guards (multi-line)', () => {
    const src = [
      'fn describe(shape) =',
      '  match shape:',
      '    Circle(r) when r > 10 -> "Large"',
      '    Circle(r) -> "Small"',
    ].join('\n');

    const ast = parse(src);
    const fn = ast.body[0] as any;
    expect(fn.type).toBe('FunctionDecl');

    // Function bodies starting with `match` are parsed as a BlockExpr container.
    const block = fn.body as any;
    expect(block.type).toBe('BlockExpr');

    const match = block.body[0] as any;
    expect(match.type).toBe('MatchExpr');
    expect(match.arms.length).toBe(2);

    expect(match.arms[0].pattern.type).toBe('ConstructorPattern');
    expect(match.arms[0].pattern.name).toBe('Circle');
    expect(match.arms[0].guard).toBeDefined();
    expect(match.arms[0].guard.condition.type).toBe('BinaryExpr');
    expect(match.arms[0].guard.condition.operator).toBe('>');

    expect(match.arms[1].pattern.type).toBe('ConstructorPattern');
    expect(match.arms[1].guard).toBeUndefined();
  });

  it('parses list patterns with rest and when guard', () => {
    // Keep arms on separate lines so `-> head` can't greedily parse `[]` as an index expression.
    const ast = parse(['match xs:', '  [head | tail] when head > 0 -> head', '  [] -> 0'].join('\n'));
    const match = ast.body[0] as any;
    expect(match.type).toBe('MatchExpr');
    expect(match.arms.length).toBe(2);

    expect(match.arms[0].pattern.type).toBe('ListPattern');
    expect(match.arms[0].pattern.rest).toBe('tail');
    expect(match.arms[0].guard).toBeDefined();
  });

  it('parses type annotations in params', () => {
    const ast = parse('fn greet(name String) -> String = name');
    const fn = ast.body[0] as any;
    expect(fn.params[0].paramType).toBeDefined();
  });

  it('parses record literal', () => {
    const ast = parse('let x = { a: 1, b: 2 }');
    expect(ast.body[0].type).toBe('LetDecl');
  });

  it('parses block expression (not record) when body starts with let', () => {
    const ast = parse('fn f() = { let x = 1 x }');
    const fn = ast.body[0] as any;
    expect(fn.type).toBe('FunctionDecl');
    expect(fn.body.type).toBe('BlockExpr');
    expect(fn.body.body[0].type).toBe('LetDecl');
  });

  it('parses list literal', () => {
    const ast = parse('let x = [1, 2, 3]');
    expect(ast.body[0].type).toBe('LetDecl');
  });

  it('parses pipe expressions', () => {
    const ast = parse('let y = x |> f |> g');
    const letDecl = ast.body[0] as any;
    expect(letDecl.type).toBe('LetDecl');
    expect(letDecl.value.type).toBe('PipeExpr');
    expect(letDecl.value.left.type).toBe('PipeExpr');
  });

  it('parses for loops - simple iteration', () => {
    const ast = parse('for x in [1, 2, 3]:\n    print(x)');
    expect(ast.body[0].type).toBe('ForExpr');
  });

  it('parses for loops with pattern matching', () => {
    const ast = parse('for Ok(value) in results:\n    print(value)');
    expect(ast.body[0].type).toBe('ForExpr');
  });

  it('parses for loops with destructuring', () => {
    const ast = parse('for (x, y) in pairs:\n    print("x")');
    expect(ast.body[0].type).toBe('ForExpr');
  });

  it('parses for loops with filtering', () => {
    const ast = parse('for x in nums if x > 0:\n    print(x)');
    expect(ast.body[0].type).toBe('ForExpr');
  });

  it('parses while loops', () => {
    const ast = parse('let mut counter = 0\nwhile counter < 5:\n    counter = counter + 1');
    const whileStmt = ast.body[1] as any;
    expect(whileStmt.type).toBe('WhileExpr');
  });

  it('parses break statements in for loops', () => {
    const src = [
      'for x in [1, 2, 3, 4, 5]:',
      '    if x == 3:',
      '        break',
    ].join('\n');
    const ast = parse(src);
    expect(ast.body[0].type).toBe('ForExpr');
  });

  it('parses continue statements in for loops', () => {
    const src = [
      'for x in [1, 2, 3, 4, 5]:',
      '    if x == 2:',
      '        continue',
    ].join('\n');
    const ast = parse(src);
    expect(ast.body[0].type).toBe('ForExpr');
  });

  it('parses list comprehensions - simple', () => {
    const ast = parse('[x for x in nums]');
    expect(ast.body[0].type).toBe('ListComprehension');
    const comp = ast.body[0] as any;
    expect(comp.element.type).toBe('Identifier');
    expect(comp.element.name).toBe('x');
    expect(comp.pattern.type).toBe('IdentifierPattern');
  });

  it('parses list comprehensions with expression', () => {
    const ast = parse('[x * 2 for x in nums]');
    expect(ast.body[0].type).toBe('ListComprehension');
    const comp = ast.body[0] as any;
    expect(comp.element.type).toBe('BinaryExpr');
    expect(comp.element.operator).toBe('*');
  });

  it('parses list comprehensions with condition', () => {
    const ast = parse('[x for x in nums if x % 2 == 0]');
    expect(ast.body[0].type).toBe('ListComprehension');
    const comp = ast.body[0] as any;
    expect(comp.condition).toBeDefined();
    expect(comp.condition.type).toBe('BinaryExpr');
  });

  it('parses list comprehensions with pattern matching', () => {
    const ast = parse('[value for Ok(value) in results]');
    expect(ast.body[0].type).toBe('ListComprehension');
    const comp = ast.body[0] as any;
    expect(comp.pattern.type).toBe('ConstructorPattern');
    expect(comp.pattern.name).toBe('Ok');
  });

  it('parses string interpolation - simple', () => {
    const ast = parse('"Hello ${name}"');
    expect(ast.body[0].type).toBe('StringInterpolation');
    const interp = ast.body[0] as any;
    expect(interp.parts.length).toBe(2);
    expect(interp.parts[0].type).toBe('StringPart');
    expect(interp.parts[0].value).toBe('Hello ');
    expect(interp.parts[1].type).toBe('ExprPart');
    expect(interp.parts[1].expr.type).toBe('Identifier');
    expect(interp.parts[1].expr.name).toBe('name');
  });

  it('parses string interpolation - multiple expressions', () => {
    const ast = parse('"${x} + ${y} = ${result}"');
    expect(ast.body[0].type).toBe('StringInterpolation');
    const interp = ast.body[0] as any;
    expect(interp.parts.length).toBe(5);
    expect(interp.parts[0].type).toBe('ExprPart');
    expect(interp.parts[1].type).toBe('StringPart');
    expect(interp.parts[2].type).toBe('ExprPart');
    expect(interp.parts[3].type).toBe('StringPart');
    expect(interp.parts[4].type).toBe('ExprPart');
  });

  it('parses string interpolation - expression call', () => {
    const ast = parse('"Result: ${obj.method()}"');
    expect(ast.body[0].type).toBe('StringInterpolation');
    const interp = ast.body[0] as any;
    expect(interp.parts[1].type).toBe('ExprPart');
    expect(interp.parts[1].expr.type).toBe('CallExpr');
  });
});