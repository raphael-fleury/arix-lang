import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';

describe('Parser', () => {
  it('parses function decorator without arguments', () => {
    const ast = parse('@Test\nfn testDivisionBy0() = 1');
    const fn = ast.body[0] as any;
    expect(fn.type).toBe('FunctionDecl');
    expect(fn.decorators).toBeDefined();
    expect(fn.decorators).toHaveLength(1);
    expect(fn.decorators[0].name).toBe('Test');
    expect(fn.decorators[0].args).toEqual([]);
  });

  it('parses function decorator with arguments', () => {
    const ast = parse('@Operator("**", "infixl", 7)\nfn pow(a, b) = a');
    const fn = ast.body[0] as any;
    expect(fn.type).toBe('FunctionDecl');
    expect(fn.decorators).toHaveLength(1);
    expect(fn.decorators[0].name).toBe('Operator');
    expect(fn.decorators[0].args).toHaveLength(3);
    expect(fn.decorators[0].args[0].type).toBe('StringLiteral');
    expect(fn.decorators[0].args[1].type).toBe('StringLiteral');
    expect(fn.decorators[0].args[2].type).toBe('NumberLiteral');
  });

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

  it('parses record type declaration with default value', () => {
    const ast = parse('type User = { name String, age Int ?? 18 }');
    const typeDecl = ast.body[0] as any;

    expect(typeDecl.type).toBe('TypeDecl');
    expect(typeDecl.name).toBe('User');
    expect(typeDecl.recordFields).toBeDefined();
    expect(typeDecl.recordFields).toHaveLength(2);
    expect(typeDecl.recordFields[0].name).toBe('name');
    expect(typeDecl.recordFields[0].fieldType.name).toBe('String');
    expect(typeDecl.recordFields[0].default).toBeUndefined();
    expect(typeDecl.recordFields[1].name).toBe('age');
    expect(typeDecl.recordFields[1].fieldType.name).toBe('Int');
    expect(typeDecl.recordFields[1].default?.type).toBe('NumberLiteral');
    expect(typeDecl.recordFields[1].default?.value).toBe(18);
  });

  it('parses type declaration with where constraints', () => {
    const ast = parse('type List(a) = Nil | Cons(head: a, tail: List(a)) where Show(a)');
    const typeDecl = ast.body[0] as any;

    expect(typeDecl.type).toBe('TypeDecl');
    expect(typeDecl.name).toBe('List');
    expect(typeDecl.typeParams).toEqual(['a']);
    expect(typeDecl.constraints).toBeDefined();
    expect(typeDecl.constraints).toHaveLength(1);
    expect(typeDecl.constraints[0].name).toBe('Show');
    expect(typeDecl.constraints[0].args).toEqual(['a']);
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

  it('parses $ as right-associative function application operator', () => {
    const ast = parse('let y = print $ f $ x');
    const letDecl = ast.body[0] as any;
    expect(letDecl.value.type).toBe('BinaryExpr');
    expect(letDecl.value.operator).toBe('$');
    expect(letDecl.value.right.type).toBe('BinaryExpr');
    expect(letDecl.value.right.operator).toBe('$');
  });

  it('parses . as function composition operator', () => {
    const ast = parse('let c = f . g');
    const letDecl = ast.body[0] as any;
    expect(letDecl.value.type).toBe('BinaryExpr');
    expect(letDecl.value.operator).toBe('.');
    expect(letDecl.value.left.type).toBe('Identifier');
    expect(letDecl.value.right.type).toBe('Identifier');
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

  it('parses operator section - binary operator', () => {
    const ast = parse('(+)');
    expect(ast.body[0].type).toBe('FunctionExpr');
    const fn = ast.body[0] as any;
    expect(fn.params.length).toBe(2);
    expect(fn.body.type).toBe('BinaryExpr');
    expect(fn.body.operator).toBe('+');
  });

  it('parses operator section - unary with right argument', () => {
    const ast = parse('(* 2)');
    expect(ast.body[0].type).toBe('FunctionExpr');
    const fn = ast.body[0] as any;
    expect(fn.params.length).toBe(1);
    expect(fn.body.type).toBe('BinaryExpr');
    expect(fn.body.operator).toBe('*');
    expect(fn.body.right.type).toBe('NumberLiteral');
    expect(fn.body.right.value).toBe(2);
  });

  it('parses operator section - unary with left argument', () => {
    const ast = parse('(3 >)');
    expect(ast.body[0].type).toBe('FunctionExpr');
    const fn = ast.body[0] as any;
    expect(fn.params.length).toBe(1);
    expect(fn.body.type).toBe('BinaryExpr');
    expect(fn.body.operator).toBe('>');
    expect(fn.body.left.type).toBe('NumberLiteral');
    expect(fn.body.left.value).toBe(3);
  });

  it('parses operator section - comparison operator', () => {
    const ast = parse('(> 0)');
    expect(ast.body[0].type).toBe('FunctionExpr');
    const fn = ast.body[0] as any;
    expect(fn.params.length).toBe(1);
    expect(fn.body.type).toBe('BinaryExpr');
    expect(fn.body.operator).toBe('>');
    expect(fn.body.right.type).toBe('NumberLiteral');
    expect(fn.body.right.value).toBe(0);
  });

  it('parses operator section - string concatenation', () => {
    const ast = parse('(++ "!")');
    expect(ast.body[0].type).toBe('FunctionExpr');
    const fn = ast.body[0] as any;
    expect(fn.params.length).toBe(1);
    expect(fn.body.type).toBe('BinaryExpr');
    expect(fn.body.operator).toBe('++');
    expect(fn.body.right.type).toBe('StringLiteral');
  });

  it('parses typeclass declaration', () => {
    const src = [
      'typeclass Show(a)',
      '  show(x a) -> String',
    ].join('\n');
    const ast = parse(src);
    expect(ast.body[0].type).toBe('TypeclassDecl');
    const tc = ast.body[0] as any;
    expect(tc.name).toBe('Show');
    expect(tc.typeParams).toEqual(['a']);
    expect(tc.methods.length).toBe(1);
    expect(tc.methods[0].name).toBe('show');
    expect(tc.methods[0].params.length).toBe(1);
  });

  it('parses typeclass with multiple type parameters', () => {
    const src = [
      'typeclass Convertible(a, b)',
      '  convert(x a) -> b',
    ].join('\n');
    const ast = parse(src);
    const tc = ast.body[0] as any;
    expect(tc.typeParams).toEqual(['a', 'b']);
  });

  it('parses typeclass with multiple methods', () => {
    const src = [
      'typeclass Eq(a)',
      '  eq(x a, y a) -> Boolean',
      '  notEq(x a, y a) -> Boolean',
    ].join('\n');
    const ast = parse(src);
    const tc = ast.body[0] as any;
    expect(tc.methods.length).toBe(2);
    expect(tc.methods[0].name).toBe('eq');
    expect(tc.methods[1].name).toBe('notEq');
  });

  it('parses decorators on typeclass methods', () => {
    const src = [
      'typeclass Show(a)',
      '  @Deprecated("Use display")',
      '  show(x a) -> String = x',
    ].join('\n');
    const ast = parse(src);
    const tc = ast.body[0] as any;
    expect(tc.methods[0].decorators).toHaveLength(1);
    expect(tc.methods[0].decorators[0].name).toBe('Deprecated');
  });

  it('parses instance declaration', () => {
    const src = [
      'impl Show for Int',
      '  show(x) = x.toString()',
    ].join('\n');
    const ast = parse(src);
    expect(ast.body[0].type).toBe('InstanceDecl');
    const inst = ast.body[0] as any;
    expect(inst.typeclass).toBe('Show');
    expect(inst.methods.length).toBe(1);
    expect(inst.methods[0].name).toBe('show');
  });

  it('parses instance with multiple types', () => {
    const src = [
      'impl Convertible for (Int, String)',
      '  convert(x) = x.toString()',
    ].join('\n');
    const ast = parse(src);
    const inst = ast.body[0] as any;
    expect(inst.typeclass).toBe('Convertible');
    expect(inst.forTypes.length).toBe(2);
  });

  it('parses instance with multiple methods', () => {
    const src = [
      'impl Eq for String',
      '  eq(x, y) = x == y',
      '  notEq(x, y) = !(x == y)',
    ].join('\n');
    const ast = parse(src);
    const inst = ast.body[0] as any;
    expect(inst.methods.length).toBe(2);
  });

  it('parses decorators on impl methods', () => {
    const src = [
      'impl Show for Int',
      '  @Memo',
      '  show(x) = x',
    ].join('\n');
    const ast = parse(src);
    const inst = ast.body[0] as any;
    expect(inst.methods[0].decorators).toHaveLength(1);
    expect(inst.methods[0].decorators[0].name).toBe('Memo');
  });

  it('parses instance declaration for ADT base type', () => {
    const src = [
      'impl Show for ADT',
      '  show(x) = x._variant',
    ].join('\n');
    const ast = parse(src);
    const inst = ast.body[0] as any;
    expect(inst.typeclass).toBe('Show');
    expect(inst.forTypes.length).toBe(1);
    expect(inst.forTypes[0].type).toBe('Identifier');
    expect(inst.forTypes[0].name).toBe('ADT');
  });

  it('parses function with where constraints', () => {
    const src = 'fn printValue(x) where Show(x) = print(show(x))';
    const ast = parse(src);
    const fn = ast.body[0] as any;
    expect(fn.constraints).toBeDefined();
    expect(fn.constraints.length).toBe(1);
    expect(fn.constraints[0].name).toBe('Show');
    expect(fn.constraints[0].args).toEqual(['x']);
  });

  it('parses function with multiple constraints', () => {
    const src = 'fn compare(x, y) where Eq(x), Show(x) = eq(x, y)';
    const ast = parse(src);
    const fn = ast.body[0] as any;
    expect(fn.constraints.length).toBe(2);
    expect(fn.constraints[0].name).toBe('Eq');
    expect(fn.constraints[1].name).toBe('Show');
  });

  it('parses typeclass with default implementations', () => {
    const src = [
      'typeclass Eq(a)',
      '  eq(x a, y a) -> Boolean',
      '  notEq(x a, y a) -> Boolean = notEq_default(x, y)',
    ].join('\n');
    const ast = parse(src);
    const tc = ast.body[0] as any;
    expect(tc.methods.length).toBe(2);
    expect(tc.methods[0].body).toBeUndefined();
    expect(tc.methods[1].body).toBeDefined();
    expect(tc.methods[1].body.type).toBe('CallExpr');
  });

  it('parses instance without implementing methods with defaults', () => {
    const src = [
      'impl Eq for Int',
      '  eq(x, y) = x == y',
    ].join('\n');
    const ast = parse(src);
    const inst = ast.body[0] as any;
    expect(inst.methods.length).toBe(1);
    expect(inst.methods[0].name).toBe('eq');
  });

  describe('Anonymous Functions (lambda syntax)', () => {
    it('parses single-param lambda', () => {
      const ast = parse('let f = (x) -> x * 2');
      const letDecl = ast.body[0] as any;
      expect(letDecl.value.type).toBe('FunctionExpr');
      const fn = letDecl.value;
      expect(fn.params.length).toBe(1);
      expect(fn.params[0].name).toBe('x');
      expect(fn.body.type).toBe('BinaryExpr');
    });

    it('parses multi-param lambda', () => {
      const ast = parse('let f = (a, b) -> a + b');
      const letDecl = ast.body[0] as any;
      expect(letDecl.value.type).toBe('FunctionExpr');
      const fn = letDecl.value;
      expect(fn.params.length).toBe(2);
      expect(fn.params[0].name).toBe('a');
      expect(fn.params[1].name).toBe('b');
    });

    it('parses zero-param lambda', () => {
      const ast = parse('let f = () -> 42');
      const letDecl = ast.body[0] as any;
      expect(letDecl.value.type).toBe('FunctionExpr');
      expect(letDecl.value.params.length).toBe(0);
      expect(letDecl.value.body.type).toBe('NumberLiteral');
    });

    it('parses lambda as function argument', () => {
      const ast = parse('map(numbers, (x) -> x * 2)');
      expect(ast.body[0].type).toBe('CallExpr');
      const call = ast.body[0] as any;
      expect(call.args.length).toBe(2);
      expect(call.args[1].type).toBe('FunctionExpr');
    });

    it('parses higher-order lambda returning another lambda', () => {
      const ast = parse('let f = (n) -> (x) -> x + n');
      const letDecl = ast.body[0] as any;
      expect(letDecl.value.type).toBe('FunctionExpr');
      const outer = letDecl.value as any;
      expect(outer.params.length).toBe(1);
      expect(outer.body.type).toBe('FunctionExpr');
      const inner = outer.body as any;
      expect(inner.params.length).toBe(1);
    });

    it('parses lambda with complex body expression', () => {
      const ast = parse('let f = (x) -> (x * 2) + (x / 3)');
      const letDecl = ast.body[0] as any;
      expect(letDecl.value.type).toBe('FunctionExpr');
      const fn = letDecl.value;
      expect(fn.body.type).toBe('BinaryExpr');
      expect(fn.body.operator).toBe('+');
    });
  });
});