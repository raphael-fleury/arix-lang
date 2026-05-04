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

function print(value) {
  const display = value !== null && value !== undefined ? String(value) : 'null';
  console.log(display);
  return display;
}

export {
  createADT,
  print
};
