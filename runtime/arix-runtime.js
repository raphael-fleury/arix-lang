/**
 * Arix Runtime
 * Generic ADT (Algebraic Data Type) constructor and utilities
 */

/**
 * Creates an Algebraic Data Type with named variants
 * @param {string} name - Name of the ADT (e.g., "Maybe", "List")
 * @param {Object} variants - Object mapping variant names to field arrays
 *   Ex: { Just: ['value'], Nothing: [] }
 * @returns {Object} ADT object with constructors and utilities
 */
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
      throw new Error(`Expected ${name}, got ${value?._type || typeof value}`);
    }

    const variant = value._variant;
    if (!(variant in patterns)) {
      throw new Error(`Unhandled variant: ${variant}`);
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

class ArixInt {
  constructor(value) {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid Int value: ${value}`);
    }
    this.value = Math.trunc(value);
    Object.freeze(this);
  }

  toString() {
    return String(this.value);
  }

  valueOf() {
    return this.value;
  }
}

class ArixFloat {
  constructor(value) {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid Float value: ${value}`);
    }
    this.value = Number(value);
    Object.freeze(this);
  }

  toString() {
    return String(this.value);
  }

  valueOf() {
    return this.value;
  }
}

function __arixIsInt(value) {
  return value instanceof ArixInt;
}

function __arixIsFloat(value) {
  return value instanceof ArixFloat;
}

function __arixUnbox(value) {
  if (__arixIsInt(value) || __arixIsFloat(value)) {
    return value.value;
  }
  return value;
}

function __arixShouldWrapBinary(a, b) {
  return __arixIsInt(a) || __arixIsFloat(a) || __arixIsInt(b) || __arixIsFloat(b);
}

function __arixWrapNumber(value, preferFloat) {
  if (!Number.isFinite(value)) {
    return new ArixFloat(value);
  }
  if (!preferFloat && Number.isInteger(value)) {
    return new ArixInt(value);
  }
  return new ArixFloat(value);
}

function __arixInt(value) {
  return new ArixInt(value);
}

function __arixFloat(value) {
  return new ArixFloat(value);
}

function __arixAdd(a, b) {
  const left = __arixUnbox(a);
  const right = __arixUnbox(b);
  if (__arixShouldWrapBinary(a, b)) {
    return __arixWrapNumber(left + right, __arixIsFloat(a) || __arixIsFloat(b));
  }
  return left + right;
}

function __arixSub(a, b) {
  const left = __arixUnbox(a);
  const right = __arixUnbox(b);
  if (__arixShouldWrapBinary(a, b)) {
    return __arixWrapNumber(left - right, __arixIsFloat(a) || __arixIsFloat(b));
  }
  return left - right;
}

function __arixMul(a, b) {
  const left = __arixUnbox(a);
  const right = __arixUnbox(b);
  if (__arixShouldWrapBinary(a, b)) {
    return __arixWrapNumber(left * right, __arixIsFloat(a) || __arixIsFloat(b));
  }
  return left * right;
}

function __arixDiv(a, b) {
  const left = __arixUnbox(a);
  const right = __arixUnbox(b);
  const result = left / right;
  if (__arixShouldWrapBinary(a, b)) {
    return __arixWrapNumber(result, true);
  }
  return result;
}

function __arixDivInt(a, b) {
  const left = __arixUnbox(a);
  const right = __arixUnbox(b);
  const result = Math.trunc(left / right);
  if (__arixShouldWrapBinary(a, b)) {
    return new ArixInt(result);
  }
  return result;
}

function __arixMod(a, b) {
  const left = __arixUnbox(a);
  const right = __arixUnbox(b);
  const result = left % right;
  if (__arixShouldWrapBinary(a, b)) {
    return __arixWrapNumber(result, __arixIsFloat(a) || __arixIsFloat(b));
  }
  return result;
}

function __arixPow(a, b) {
  const left = __arixUnbox(a);
  const right = __arixUnbox(b);
  const result = left ** right;
  if (__arixShouldWrapBinary(a, b)) {
    const preferFloat = __arixIsFloat(a) || __arixIsFloat(b) || !Number.isInteger(result);
    return __arixWrapNumber(result, preferFloat);
  }
  return result;
}

function __arixNeg(a) {
  const value = __arixUnbox(a);
  const result = -value;
  if (__arixIsInt(a)) {
    return new ArixInt(result);
  }
  if (__arixIsFloat(a)) {
    return new ArixFloat(result);
  }
  return result;
}

function __arixEq(a, b) {
  return __arixUnbox(a) === __arixUnbox(b);
}

function __arixNe(a, b) {
  return __arixUnbox(a) !== __arixUnbox(b);
}

function __arixLt(a, b) {
  return __arixUnbox(a) < __arixUnbox(b);
}

function __arixGt(a, b) {
  return __arixUnbox(a) > __arixUnbox(b);
}

function __arixLte(a, b) {
  return __arixUnbox(a) <= __arixUnbox(b);
}

function __arixGte(a, b) {
  return __arixUnbox(a) >= __arixUnbox(b);
}

/**
 * Namespace for native JavaScript operators and globals
 * Used when operator implementations need to access raw JS operations
 * Example: In impl Eq for Int, use js.EQ(x, y) instead of x == y
 * Also provides access to globals like js.console, js.Math, etc.
 */
const js = new Proxy(
  {
    // Comparison operators
    EQ: (a, b) => __arixEq(a, b),
    NE: (a, b) => __arixNe(a, b),
    LT: (a, b) => __arixLt(a, b),
    GT: (a, b) => __arixGt(a, b),
    LTE: (a, b) => __arixLte(a, b),
    GTE: (a, b) => __arixGte(a, b),
    
    // Arithmetic operators
    ADD: (a, b) => __arixAdd(a, b),
    SUB: (a, b) => __arixSub(a, b),
    MUL: (a, b) => __arixMul(a, b),
    DIV: (a, b) => __arixDiv(a, b),
    DIV_INT: (a, b) => __arixDivInt(a, b),
    MOD: (a, b) => __arixMod(a, b),
    POW: (a, b) => __arixPow(a, b),
    NEG: (a) => __arixNeg(a),
    
    // Logical operators (JS truthiness)
    AND: (a, b) => a && b,
    OR: (a, b) => a || b,
    NOT: (a) => !a,
    
    // Bitwise operators
    BAND: (a, b) => a & b,
    BOR: (a, b) => a | b,
    BXOR: (a, b) => a ^ b,
    BNOT: (a) => ~a,
    LSHIFT: (a, b) => a << b,
    RSHIFT: (a, b) => a >> b,
    URSHIFT: (a, b) => a >>> b,
  },
  {
    get(target, prop) {
      // First check if it's a defined operator
      if (prop in target) {
        return target[prop];
      }
      // Otherwise, forward to globalThis for JS interop
      return globalThis[prop];
    }
  }
);

export {
  createADT,
  js,
  ArixInt,
  ArixFloat,
  __arixInt,
  __arixFloat,
  __arixIsInt,
  __arixIsFloat,
  __arixUnbox
};
