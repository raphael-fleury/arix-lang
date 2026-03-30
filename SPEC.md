# Purl - Functional-First Programming Language

## 1. Overview

**Purl** is a functional-first programming language designed with a low learning curve for OOP and imperative developers. It compiles to JavaScript/WASM.

### Design Goals
- Low barrier to entry for OOP developers
- Functional programming concepts without intimidation
- Python-like syntax familiarity
- Strong type safety with inference

---

## 2. Syntax

### 2.1 Basic Syntax
- Indentation-based (significant whitespace)
- Keywords: `fn`, `let`, `let mut`, `public`, `internal`, `match`, `if`, `else`, `when`, `import`, `type`, `try`, `catch`, `async`, `await`
- Comments: `# single line`, `""" multi-line """`

### 2.2 Nomenclature
- **Types**: PascalCase (`User`, `Option`, `Result`)
- **Functions/Variables**: camelCase (`getUser`, `isValid`, `userName`)
- **Constants**: SCREAMING_SNAKE_CASE (`MAX_RETRIES`)
- **Files**: kebab-case (`user-service.purl`, `my-utils.purl`)

---

## 3. Types

### 3.1 Primitive Types
- `Int`, `Float`, `Bool`, `String`, `Char`
- `Unit` (void/nothing)

### 3.2 Generic Types
- Syntax: parentheses `(a, b)`
- Examples: `Option(a)`, `Result(a, e)`, `List(a)`, `Pair(a, b)`

### 3.3 Union Types
```python
type Shape = Circle(r Float) | Rectangle(w Float, h Float)
type Result(a, e) = Ok(a) | Err(e)
type Option(a) = Some(a) | None
```

### 3.4 Records
```python
type User = {
    name String,
    email String,
    age Int,
}

user = { name: "Ana", age: 30 }
```

### 3.5 Type Inference
- Strong inference for local variables and private functions
- Type annotations **required** for public functions

```python
# Inferred
let x = 10              # Int
let name = "Ana"        # String

# Annotated (public)
public fn add(a Int, b Int) Int = a + b
```

---

## 4. Variables

### 4.1 Immutability
```python
let x = 10
# x = 20  # Error!

let mut counter = 0
counter = counter + 1  # OK
```

### 4.2 Destructuring
```python
let { name, age } = user
let { name as userName } = user
let { name, email ?? "default-value" } = data

let (x, y) = (1, 2)
let [first | rest] = [1, 2, 3]
let [first, second | rest] = [1, 2, 3]
```

---

## 5. Functions

### 5.1 Definition
```python
fn add(a, b) = a + b
fn greet(name) = "Hello, ${name}!"

# With annotations
fn add(a Int, b Int) Int = a + b
```

### 5.2 Currying (Optional)
```python
# All equivalent:
add(1, 2)      # Direct
add(1)(2)      # Curried
let addOne = add(1)  # Partial application
```

### 5.3 Async Functions
```python
async fn fetchUser(id Int) Result(User, String) =
    let response = await http.get("/api/users/${id}")
    match response:
        Ok(r) if r.ok -> Ok(r.json())
        Ok(r) -> Err("HTTP ${r.status}")
        Err(e) -> Err(e.message)
```

### 5.4 Section Operators
```python
nums.map(* 2)           # x => x * 2
nums.filter(> 3)        # x => x > 3
nums.filter(== 0)       # x => x == 0
list.map(++ "!")        # x => x ++ "!"
add = (+)               # (a, b) => a + b
```

### 5.5 Pipe Operator
```python
numbers
    |> map(* 2)
    |> filter(> 0)
    |> reduce(0, +)
```

---

## 6. Pattern Matching

### 6.1 Basic Match
```python
result = match value:
    0 -> "zero"
    n when n > 0 -> "positive"
    _ -> "negative"
```

### 6.2 Pattern Guards
```python
match user:
    { age } when age >= 18 -> "adult"
    { age } when age >= 65 -> "senior"
    _ -> "minor"
```

### 6.3 Match Contexts
- Expression: `let x = match ...`
- Function return: `fn f() = match ...`
- Let binding: `let Ok(v) = result`
- Parameters: `fn process(Ok(v)) = ...`
- For loops: `for Ok(v) in results:`
- Comprehensions: `[v for Ok(v) in results]`

---

## 7. Data Structures

### 7.1 Lists
```python
let nums = [10, 20, 30]

# List comprehension
evens = [x for x in nums if x % 2 == 0]
doubled = [x * 2 for x in nums]

# Index access (Rust-style with .get())
nums.get(0)              # Option(Int) => Some(10)
nums.get(5)              # Option(Int) => None
nums.get(5, 0)           # Int => 0 (default fallback)
nums.getFirst()          # Option(Int) => Some(10)
nums.getLast()           # Option(Int) => Some(30)
nums.length()            # Int => 3
nums.isEmpty()          # Bool => False
```

### 7.2 Options and Results
```python
# Option
type Option(a) = Some(a) | None

let age = findAge(userId) ?? 0

# Result  
type Result(a, e) = Ok(a) | Err(e)

match parseInt(input):
    Ok(n) -> n * 2
    Err(e) -> 0
```

### 7.3 Tuples
```python
let pair = (1, "one")
let (num, str) = pair
```

---

## 8. Modules and Imports

Purl uses ES Modules (ESM) for JavaScript interoperability. Each `.purl` file is a module.

### 8.1 File Naming Convention
- Files use **kebab-case**: `user-service.purl`, `my-utils.purl`
- Module name derives from filename: `user-service.purl` → `user-service`

### 8.2 Import Syntax
```python
# Local module (searches in src/ and project root)
import user-service

# Local module with selective imports
import user-service (getUser, createUser)

# Relative import
import ./helper-utils

# Relative import with selective imports
import ../shared (formatDate)

# Stdlib modules (built-in)
import result
import option
import list
```

### 8.3 Module Resolution
```
1. Relative imports (./foo, ../foo) → ./foo.purl
2. Named imports (foo-bar) → {src,root}/foo-bar.purl
3. Stdlib (result, option, list) → built-in runtime
```

### 8.4 Visibility
```python
# Private (default) - file only
fn helper() = ...

# Internal - not yet implemented
# internal fn internalFunc() = ...

# Public - exported
public fn publicFunc() = ...
```

### 8.5 Compilation
```bash
# Compile single file (resolves and compiles dependencies)
purl build src/main.purl -o dist/

# Compile to single bundle
purl build src/main.purl -o dist/bundle.js

# Output structure
dist/
├── main.js
├── user-service.js
└── helper-utils.js
```

### 8.6 Example Project Structure
```
project/
├── src/
│   ├── main.purl
│   ├── user-service.purl
│   └── helper-utils.purl
└── dist/
    ├── main.js
    ├── user-service.js
    └── helper-utils.js
```

---

## 9. Error Handling

### 9.1 Option Type
```python
type Option(a) = Some(a) | None

fn findUser(id Int) Option(User) = ...
```

### 9.2 Result Type
```python
type Result(a, e) = Ok(a) | Err(e)

fn parseInt(s String) Result(Int, String) = ...
```

### 9.3 Async Error Handling
```python
async fn fetchUser(id Int) Result(User, String) =
    try await http.get("/api/users/${id}")
    catch e:
        Err(e.message)
```

---

## 10. Documentation

### 10.1 Docstrings
```python
"""
Calculates the area of a shape.
Returns the value in square units.
"""
fn area(shape Shape) Float = ...
```

### 10.2 Type Annotations
```python
public fn fetchUser
    """Fetches a user by ID.
    
    @param id - unique identifier
    @returns Some(User) if found, None otherwise
    """
    id Int
    -> Option(User)
= ...
```

---

## 11. Reserved Keywords
```
fn, let, let mut, if, else, match, when, import, type,
public, internal, async, await, try, catch, throw,
return, yield, as, in, for, while, loop, break, continue,
true, false, None, Ok, Err, Some, module, where, use
```

---

## 12. Examples

### 12.1 Hello World
```python
fn main() =
    let name = "World"
    print("Hello, ${name}!")
```

### 12.2 Functional Pipeline
```python
fn processNumbers(nums List(Int)) Int =
    nums
        |> map(* 2)
        |> filter(> 0)
        |> reduce(0, +)

public fn main() =
    let result = processNumbers([1, -2, 3, -4, 5])
    print(result.show())  # 16
```

### 12.3 Pattern Matching
```python
type Shape = Circle(r Float) | Rectangle(w Float, h Float)

fn area(shape Shape) Float =
    match shape:
        Circle(r) -> 3.14159 * r * r
        Rectangle(w, h) -> w * h

fn describe(shape Shape) String =
    match shape:
        Circle(r) when r > 10 -> "Large circle"
        Circle(r) -> "Small circle"
        Rectangle(w, h) when w == h -> "Square"
        _ -> "Rectangle"
```

### 12.4 Async/Await
```python
async fn fetchUserData(id Int) Result(User, String) =
    let response = await http.get("/api/users/${id}")
    match response:
        Ok(r) if r.ok -> Ok(r.json())
        Ok(r) -> Err("Request failed: ${r.status}")
        Err(e) -> Err("Network error: ${e.message}")

public async fn main() =
    match await fetchUserData(123):
        Ok(user) -> print("Hello, ${user.name}!")
        Err(e) -> print("Error: ${e}")
```

---

## Appendix A: Grammar Summary

```
program       ::= stmt*
stmt          ::= letDecl | fnDecl | typeDecl | importStmt | expr

letDecl       ::= 'let' ['mut'] pattern ['??' expr] '=' expr
fnDecl        ::= ['public' | 'internal'] 'async'? 'fn' pattern params? ['->' type] '=' expr
pattern       ::= identifier | recordPat | tuplePat | listPat | typePat
recordPat     ::= '{' (pattern (',' pattern)*)? ['..' ident]? '}'
tuplePat      ::= '(' pattern (',' pattern)* ')'
listPat       ::= '[' pattern ('|' pattern)? ']'
typePat       ::= ident '(' pattern (',' pattern)* ')'

expr          ::= ifExpr | matchExpr | fnExpr | pipeExpr | ...
ifExpr        ::= 'if' expr 'then' expr 'else' expr
matchExpr     ::= 'match' expr ':' matchArm*
matchArm      ::= pattern ['when' expr] '->' expr
fnExpr        ::= 'fn' params ['->' type] '=' expr
pipeExpr      ::= expr ('|>' expr)+

importStmt    ::= 'import' ident ['as' ident] ['(' importItems ')'] ['hiding' '(' importItems ')']
importItems   ::= ident (',' ident)*
```

---

## Appendix B: Standard Library Types

```python
# Option
type Option(a) = Some(a) | None

# Result  
type Result(a, e) = Ok(a) | Err(e)

# List
type List(a) = Cons(a, List(a)) | Nil

# Tuple
type Tuple2(a, b) = (a, b)
type Tuple3(a, b, c) = (a, b, c)
```

---

## Appendix C: Differences from Python

| Feature | Python | Purl |
|---------|--------|------|
| Immutability | opt-in with frozen | default |
| Currying | via libraries | built-in |
| Pattern matching | match-case (limited) | full PM |
| Type system | dynamic + TypeGuard | strong static |
| Null | None | Option/Result |
| Pipe | \|> (3.10+) | native |

---

*Version: 1.0-draft*
*Last Updated: 2026-03-29*
