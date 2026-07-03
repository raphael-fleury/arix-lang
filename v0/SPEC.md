# Arix - Functional-First Programming Language

## 1. Overview

**Arix** is a functional-first programming language designed to have a low learning curve for OOP and imperative developers. It compiles to C.

### Design Goals
- Low barrier to entry for OOP developers
- Functional programming concepts without intimidation
- Syntax familiarity
- Strong type safety with inference

## 2. Syntax

Blocks start and end with braces, and statements end with semicolons.

### 2.1 Nomenclature
- **Types and Modules**: PascalCase (`Int`, `Float`, `Char`)
- **Variables and Functions**: camelCase (`getUser`, `isValid`, `userName`)
- **Files**: kebab-case (`user-service.arix`, `my-utils.arix`)

### 2.2 Comments
```javascript
// single line comment
/*
multi-line comment
*/
```

### 2.3 Constant variables
```javascript
let bar: Int = 7;
```
 
### 2.4 Functions
```javascript
let multiply: (Int, Int) => Int = (a, b) => repeat(sum(a, a), b);
```

### 2.5 Enums (ADTs)
```javascript
enum Direction { North, South, East, West }

enum List<T> { Cons(T, List<T>), Nil }

enum Maybe<T> {
    Just(T), Nothing
}
```

### 2.6 Typeclasses
```javascript
typeclass Eq<T> {
    equal: (a: T, b: T) => Bool;
    notEqual: (a: T, b: T) => Bool = not(equal(a, b)); // default value
}

// With restrictions
typeclass Sortable<T<A>> where Orderable<A> {
    sort: (sortable: T<A>) => T<A>;
}

typeclass Readable<T> {
    read: (text: Array<Char>) => T;
}

read<Bool>(['t','r','u','e']);
read<Int>(['1','0']);
```

### 2.7 Typeclass implementations
```javascript
implementation Eq<T> {
    equal = (a, b) => ...;
    // keep default notEqual
}
```

### 2.8 Pattern Matching
```javascript
match result {
    Ok(Cons(value)) when lessThanOrEqual(value, 0) => 0; // Nested matching
    Ok(Cons(_)) => 1; // Nested matching with wildcard to ignore value
    Ok(_) => 0;
    Error(error) => 0;
    _ => 0;
}
```

### 2.9 Array creation
```javascript
[1,2,3] // to create an array of ints
['a', 'b', 'c'] // to create an array of chars
[True, False] // to create an array of bools
```

## 3. Types

### 3.1 Built-in Types
- `Int`, `Float`, `Char`, `Bool`, `Array<T>`

### 3.2 Generic Types
- `List<T>`, `Maybe<T>`, `Result<TSuccess, TError>`

## 4. Modules and imports

Every file is a module. Modules can be imported using the `import` keyword and declared with `module`.

```javascript
module Math;

let pow: (a: Int, b: Int) => Int = ...
```

