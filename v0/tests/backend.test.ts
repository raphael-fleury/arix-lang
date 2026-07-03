import { describe, expect, it } from 'vitest'
import { compileSourceToC } from '../src/index.js'

describe('backend', () => {
  it('emits C for a let-bound main lambda and arrays', () => {
    const result = compileSourceToC(`
      let items: Array<Int> = [1, 2, 3];
      let main: () => Int = () => 42;
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.cSource).toContain('typedef struct ArixValue')
    expect(result.cSource).toContain('static ArixValue *arix_main(void)')
    expect(result.cSource).toContain('arix_array(3')
    expect(result.cSource).toContain('return arix_int(42);')
  })

  it('emits constructors and match lowering for enums', () => {
    const result = compileSourceToC(`
      enum Maybe<T> { Just(T), Nothing }

      let main: () => Int = () => match Just(1) {
        Just(item) => item;
        Nothing => 0;
      };
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.cSource).toContain('enum MaybeTag')
    expect(result.cSource).toContain('static ArixValue *Maybe_Just(ArixValue *field0)')
    expect(result.cSource).toContain('if (__match_value_')
    expect(result.cSource).toContain('value->tag = Maybe_Just')
  })

  it('accepts typeclass declarations without backend regressions', () => {
    const result = compileSourceToC(`
      typeclass Eq<T> {
        equal: (T, T) => Bool;
        notEqual: (T, T) => Bool = (a, b) => False;
      }

      implementation Eq<T> {
        equal = (a, b) => True;
      }

      let main: () => Int = () => 1;
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.cSource).toContain('static ArixValue *arix_main(void)')
  })

  it('handles char literals and generic call syntax', () => {
    const result = compileSourceToC(`
      let main: () => Int = () => {
        let letters: Array<Char> = ['a', 'b'];
        read<Bool>(letters);
        'c';
      };
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.cSource).toContain("arix_int('a')")
    expect(result.cSource).toContain("arix_int('c')")
  })

  it('dispatches generic method calls to implementation functions', () => {
    const result = compileSourceToC(`
      typeclass Eq<T> {
        equal: (T, T) => Bool;
      }

      implementation Eq<Int> {
        equal = (a, b) => True;
      }

      let main: () => Bool = () => equal<Int>(1, 2);
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.cSource).toContain('static ArixValue *impl_Eq_equal_Int(ArixValue *a, ArixValue *b)')
    expect(result.cSource).toContain('return impl_Eq_equal_Int(arix_int(1), arix_int(2));')
  })
})