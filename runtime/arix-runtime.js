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

  // Create constructor functions for each variant
  for (const [variantName, fields] of Object.entries(variants)) {
    adt[variantName] = (...values) => {
      const instance = {
        _type: name,
        _variant: variantName,
        _values: values
      };
      
      // Add named fields for easy access
      fields.forEach((field, i) => {
        instance[field] = values[i];
      });
      
      return Object.freeze(instance);
    };
  }

  /**
   * Pattern match on ADT values
   * @param {Object} value - ADT instance
   * @param {Object} patterns - Object mapping variant names to handlers
   * @returns {*} Result of the matched handler
   */
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

  /**
   * Check if a value is an instance of this ADT
   */
  adt.isInstance = (value) => {
    return value && value._type === name;
  };

  return adt;
}

/**
 * Built-in ADTs
 */

// Maybe type: represents an optional value
const Maybe = createADT('Maybe', {
  Just: ['value'],
  Nothing: []
});

// List type: represents a linked list (for immutable list operations)
const List = createADT('List', {
  Cons: ['head', 'tail'],
  Nil: []
});

/**
 * Helper to create a list from an array
 */
function arrayToList(arr) {
  let result = List.Nil();
  for (let i = arr.length - 1; i >= 0; i--) {
    result = List.Cons(arr[i], result);
  }
  return result;
}

/**
 * Helper to convert a list to an array
 */
function listToArray(list) {
  const result = [];
  let current = list;
  while (current._variant === 'Cons') {
    result.push(current.head);
    current = current.tail;
  }
  return result;
}

// Result type: represents success or failure
const Result = createADT('Result', {
  Ok: ['value'],
  Err: ['error']
});

/**
 * Utilities for working with Options/Maybe
 */
const MaybeUtils = {
  map: (maybeValue, fn) => {
    return Maybe.match(maybeValue, {
      Just: (value) => Maybe.Just(fn(value)),
      Nothing: () => Maybe.Nothing()
    });
  },

  flatMap: (maybeValue, fn) => {
    return Maybe.match(maybeValue, {
      Just: (value) => fn(value),
      Nothing: () => Maybe.Nothing()
    });
  },

  getOrElse: (maybeValue, defaultValue) => {
    return Maybe.match(maybeValue, {
      Just: (value) => value,
      Nothing: () => defaultValue
    });
  },

  isSome: (maybeValue) => {
    return Maybe.match(maybeValue, {
      Just: () => true,
      Nothing: () => false
    });
  }
};

/**
 * Utilities for working with Results
 */
const ResultUtils = {
  map: (result, fn) => {
    return Result.match(result, {
      Ok: (value) => Result.Ok(fn(value)),
      Err: (error) => Result.Err(error)
    });
  },

  flatMap: (result, fn) => {
    return Result.match(result, {
      Ok: (value) => fn(value),
      Err: (error) => Result.Err(error)
    });
  },

  isOk: (result) => {
    return Result.match(result, {
      Ok: () => true,
      Err: () => false
    });
  },

  getOrElse: (result, defaultValue) => {
    return Result.match(result, {
      Ok: (value) => value,
      Err: () => defaultValue
    });
  }
};

function print(value) {
  const display = value !== null && value !== undefined ? String(value) : 'null';
  console.log(display);
  return display;
}

// Export for use in generated JavaScript
export {
  createADT,
  Maybe,
  MaybeUtils,
  List,
  arrayToList,
  listToArray,
  Result,
  ResultUtils,
  print
};
