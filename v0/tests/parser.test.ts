import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.js'

describe('parser', () => {
  it('parses a module with an enum, let bindings, arrays, and lambdas', () => {
    const program = parse(`
      module Demo;
      enum Maybe<T> { Just(T), Nothing }
      let items: Array<Int> = [1, 2, 3];
      let main: () => Int = () => 1;
    `)

    expect(program.moduleName).toBe('Demo')
    expect(program.body.some(node => node.type === 'EnumDecl')).toBe(true)
    expect(program.body.some(node => node.type === 'LetDecl')).toBe(true)
  })

  it('parses typeclasses and implementations', () => {
    const program = parse(`
      typeclass Eq<T> where Ord<T> {
        equal: (T, T) => Bool;
        notEqual: (T, T) => Bool = (a, b) => False;
      }

      implementation Eq<T> {
        equal = (a, b) => True;
      }

      let parsed: Bool = read<Bool>(['t']);
    `)

    const typeclassDecl = program.body.find(node => node.type === 'TypeclassDecl') as any
    const letDecl = program.body.find(node => node.type === 'LetDecl') as any
    expect(typeclassDecl).toBeDefined()
    expect(typeclassDecl.constraints).toHaveLength(1)
    expect(typeclassDecl.constraints[0].name).toBe('Ord')
    expect(program.body.some(node => node.type === 'ImplementationDecl')).toBe(true)
    expect(letDecl.value.type).toBe('CallExpr')
    expect(letDecl.value.genericArgs).toHaveLength(1)
  })

  it('parses match arm guards with when', () => {
    const program = parse(`
      let main: () => Int = () => match value {
        Just(x) when True => 1;
        _ => 0;
      };
    `)

    const letDecl = program.body.find(node => node.type === 'LetDecl') as any
    const matchExpr = letDecl.value.body
    expect(matchExpr.type).toBe('MatchExpr')
    expect(matchExpr.arms[0].guard).toBeDefined()
    expect(matchExpr.arms[1].guard).toBeUndefined()
  })
})