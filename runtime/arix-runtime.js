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

/**
 * Namespace for native JavaScript operators
 * Used when operator implementations need to access raw JS operations
 * Example: In impl Eq for Int, use js.EQ(x, y) instead of x == y
 */
const js = {
  // Comparison operators
  EQ: (a, b) => a === b,
  NE: (a, b) => a !== b,
  LT: (a, b) => a < b,
  GT: (a, b) => a > b,
  LTE: (a, b) => a <= b,
  GTE: (a, b) => a >= b,
  
  // Arithmetic operators
  ADD: (a, b) => a + b,
  SUB: (a, b) => a - b,
  MUL: (a, b) => a * b,
  DIV: (a, b) => a / b,
  MOD: (a, b) => a % b,
  POW: (a, b) => a ** b,
  
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
};

export {
  createADT,
  js
};
