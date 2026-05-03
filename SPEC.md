# Arix - Functional-First Programming Language

## 1. Overview

**Arix** is a functional-first programming language designed with a low learning curve for OOP and imperative developers. It compiles to JavaScript/WASM.

### Design Goals
- Low barrier to entry for OOP developers
- Functional programming concepts without intimidation
- Python-like syntax familiarity
- Strong type safety with inference

---

## 2. Syntax

### 2.1 Basic Syntax
- Indentation-based (significant whitespace)
- Keywords: `fn`, `let`, `let mut`, `public`, `internal`, `match`, `if`, `else`, `when`, `import`, `type`, `typeclass`, `impl`, `for`, `try`, `catch`, `async`, `await`
- Comments: `# single line`, `""" multi-line """`

### 2.2 Nomenclature
- **Types**: PascalCase (`User`, `Maybe`, `Result`)
- **Functions/Variables**: camelCase (`getUser`, `isValid`, `userName`)
- **Constants**: SCREAMING_SNAKE_CASE (`MAX_RETRIES`)
- **Files**: kebab-case (`user-service.arix`, `my-utils.arix`)

---

## 3. Types

### 3.1 Primitive Types
- `Int`, `Float`, `Bool`, `String`, `Char`
- `Unit` (void/nothing)

### 3.2 Generic Types
- Syntax: parentheses `(a, b)`
- Examples: `Maybe(a)`, `Result(a, e)`, `List(a)`, `Pair(a, b)`

### 3.3 Records
```python
type User = {
    name String,
    email String,
    age Int,
}

user = { name: "Ana", age: 30 }
```

### 3.4 Type Inference
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

## 4. Algebraic Data Types (ADTs)

Arix supports **Algebraic Data Types** through a generic ADT constructor in the runtime. ADTs allow you to define custom types with multiple named variants, enabling type-safe pattern matching and functional data structures.

### 4.1 Creating ADTs

Use the built-in `createADT` function to define custom types:

```python
# In Arix (future syntax, currently use JavaScript)
# type Maybe(a) = Just(a) | Nothing
# type Result(a, e) = Ok(a) | Err(e)
```

The runtime provides ready-to-use ADTs:
- **Maybe**: Optional values (`Just(value)`, `Nothing()`)
- **Result**: Success/failure (`Ok(value)`, `Err(error)`)
- **List**: Immutable linked list (`Cons(head, tail)`, `Nil()`)

### 4.2 Working with Built-in ADTs

#### Maybe Type
```python
fn getUser(id) =
    let user = Maybe.Just({ name: "Alice", age: 30 })
    match user:
        Just(u) -> "Found: ${u.name}"
        Nothing -> "User not found"

# Or using utilities
let age = user |> MaybeUtils.map(u => u.age)
let nameOrDefault = MaybeUtils.getOrElse(user, { name: "Unknown" })
```

#### Result Type
```python
fn divide(a, b) =
    if b == 0:
        Result.Err("Division by zero")
    else:
        Result.Ok(a / b)

fn main() =
    let result = divide(10, 2)
    match result:
        Ok(value) -> "Result: ${value}"
        Err(error) -> "Error: ${error}"
```

### 4.3 Custom ADTs

Define custom algebraic data types for your domain:

```python
# Domain model for user status
type UserStatus = Active | Inactive | Banned

# With associated data
type UserStatus = 
    | Active(userId, lastLogin)
    | Inactive(userId, reason)
    | Banned(userId)

fn checkStatus(user) =
    match user.status:
        Active(id, login) -> "Active since ${login}"
        Inactive(id, reason) -> "Inactive: ${reason}"
        Banned(id) -> "Banned"
```

### 4.4 Tree Example (Nested ADTs)

```python
# Binary tree
type Tree = 
    | Node(value, left, right)
    | Empty

fn sumTree(node) =
    match node:
        Node(v, left, right) -> v + sumTree(left) + sumTree(right)
        Empty -> 0

let tree = Node(5, Node(3, Empty, Empty), Node(7, Empty, Empty))
let total = sumTree(tree)  # 5 + 3 + 7 = 15
```

### 4.5 ADT Benefits

✓ **Type Safety**: Exhaustive pattern matching ensures all cases are handled
✓ **Composability**: Nest ADTs for complex data structures
✓ **Functional**: Immutable by default, perfect for functional programming
✓ **Expressive**: Models domain logic directly in types

---

## 5. Variables

### 5.1 Immutability
```python
let x = 10
# x = 20  # Error!

let mut counter = 0
counter = counter + 1  # OK
```

### 5.2 Destructuring
```python
let { name, age } = user
let { name as userName } = user
let { name, email ?? "default-value" } = data

let (x, y) = (1, 2)
let [first | rest] = [1, 2, 3]
let [first, second | rest] = [1, 2, 3]
```

---

## 6. Functions

### 6.1 Definition
```python
fn add(a, b) = a + b
fn greet(name) = "Hello, ${name}!"

# With annotations
fn add(a Int, b Int) Int = a + b
```

### 6.2 Currying (Optional)
```python
# All equivalent:
add(1, 2)      # Direct
add(1)(2)      # Curried
let addOne = add(1)  # Partial application
```

### 6.3 Async Functions
```python
async fn fetchUser(id Int) Result(User, String) =
    let response = await http.get("/api/users/${id}")
    match response:
        Ok(r) if r.ok -> Ok(r.json())
        Ok(r) -> Err("HTTP ${r.status}")
        Err(e) -> Err(e.message)
```

### 6.4 Section Operators
```python
(* 2)     # x => x * 2
(> 3)     # x => x > 3
(3 >)     # x => 3 > x
(== 0)    # x => x == 0
(++ "!")  # x => x ++ "!"
(+)       # (a, b) => a + b
```

### 6.5 Pipe Operator
```python
numbers
    |> map(* 2)
    |> filter(> 0)
    |> reduce(0, +)
```

---

## 7. Pattern Matching

### 7.1 Basic Match
```python
result = match value:
    0 -> "zero"
    n when n > 0 -> "positive"
    _ -> "negative"
```

### 7.2 Pattern Guards
```python
match user:
    { age } when age >= 18 -> "adult"
    { age } when age >= 65 -> "senior"
    _ -> "minor"
```

### 7.3 Match Contexts
- Expression: `let x = match ...`
- Function return: `fn f() = match ...`
- Let binding: `let Ok(v) = result`
- Parameters: `fn process(Ok(v)) = ...`
- For loops: `for Ok(v) in results:`
- Comprehensions: `[v for Ok(v) in results]`

---

## 8. Data Structures

### 8.1 Lists
```python
let nums = [10, 20, 30]

# List comprehension
evens = [x for x in nums if x % 2 == 0]
doubled = [x * 2 for x in nums]

# Access and functions
nums !! 0                # Option(Int) => Some(10)
nums !! 5                # Option(Int) => None
nums !! 5 ?? 0           # Int => 0 (default fallback)
head nums                # Option(Int) => Some(10)
last nums                # Option(Int) => Some(30)
length nums              # Int => 3
isEmpty nums             # Bool => False
```

### 8.2 Maybe and Results
```python
# Maybe
type Maybe(a) = Just(a) | Nothing

let age = findAge(userId) ?? 0

# Result  
type Result(a, e) = Ok(a) | Err(e)

match parseInt(input):
    Ok(n) -> n * 2
    Err(e) -> 0
```

### 8.3 Tuples
```python
let pair = (1, "one")
let (num, str) = pair
```

---

## 9. Typeclasses

Typeclasses define a set of methods (a contract) that types can implement. They enable **ad-hoc polymorphism**: functions that work with multiple types, constrained by the typeclasses they implement.

### 9.1 Typeclass Definition

Use the `typeclass` keyword to define a typeclass. Always include type parameters in parentheses, even for single-parameter typeclasses.

```python
typeclass Show(a)
  show(x a) -> String

typeclass Eq(a)
  eq(x a, y a) -> Boolean
  notEq(x a, y a) -> Boolean = !(eq(x, y))  # Default implementations allowed

typeclass Convertible(a, b)
  convert(x a) -> b
```

**Rules:**
- Name is **PascalCase**
- Type parameters are required: `(a)`, `(a, b)`, etc.
- Methods specify **full signatures** with parameter names and types
- **Default implementations** use `=` and can reference other methods in the same typeclass
- Method names are **camelCase**

### 9.2 Instance Implementation

Use `impl` to implement a typeclass for a specific type:

```python
impl Show for Int
  show(x) = x.toString()

impl Eq for String
  eq(x, y) = x == y
  notEq(x, y) = !(x == y)

impl Convertible for (Int, String)
  convert(x) = x.toString()
```

**Rules:**
- `impl Typeclass for ConcreteType` for single-parameter typeclasses
- `impl Typeclass for (Type1, Type2)` for multi-parameter typeclasses
- All non-default methods must be implemented
- Default methods are inherited automatically
- Method bodies are single expressions

### 9.3 Type Constraints in Functions

Use the `where` keyword to constrain type parameters:

```python
# Single constraint
fn display(x) where Show(x) =
  print(show(x))

# Multiple constraints
fn compareAndPrint(x, y) where Eq(x), Show(x) =
  if eq(x, y):
    print("Equal: " ++ show(x))
  else:
    print("Not equal")

# Constraints with multiple type parameters
fn convertAndStore(value) where Convertible(value, String) =
  let str = convert(value)
  store(str)
```

**Rules:**
- `where` keyword precedes comma-separated constraints
- Each constraint: `Typeclass(typeVar, ...)`
- Type variables must match function parameters
- No implicit constraint propagation — each constraint must be explicit

### 9.4 Method Dispatch

Method dispatch is **implicit** — the compiler selects the correct implementation based on type:

```python
typeclass Show(a)
  show(x a) -> String

impl Show for Int
  show(x) = x.toString()

impl Show for String
  show(x) = x

fn displayIt(x) where Show(x) =
  show(x)  # Dispatch resolved by type of x

displayIt(42)           # "42"
displayIt("hello")      # "hello"
```

### 9.5 Generic Implementations

Implement typeclasses for generic types:

```python
impl Show for List(a) when Show(a)
  show(list) = match list:
    [] -> "[]"
    [h | t] -> "[" ++ show(h) ++ ", " ++ show(t) ++ "]"
```

### 9.6 Inheritance-like Constraints

Typeclasses can depend on other typeclasses:

```python
typeclass Eq(a)
  eq(x a, y a) -> Boolean

typeclass Ord(a) where Eq(a)
  lt(x a, y a) -> Boolean
  le(x a, y a) -> Boolean = lt(x, y) || eq(x, y)
  gt(x a, y a) -> Boolean = !le(x, y)
  ge(x a, y a) -> Boolean = !lt(x, y)

impl Eq for Int
  eq(x, y) = x == y

impl Ord for Int
  lt(x, y) = x < y
```

When implementing `Ord`, the `Eq` instance must already exist for the same type.

---

## 10. Loops

### 9.1 For Loops

For loops iterate over iterables with pattern matching support.

```python
# Simple iteration
for x in [1, 2, 3]:
    print(x)

# With pattern matching
for Ok(value) in results:
    print(value)

for (x, y) in pairs:
    print("${x}, ${y}")

# With filtering
for x in nums if x > 0:
    print(x)
```

#### Loop Variables
- Loop variables are **immutable** within the loop scope

```python
let mut sum = 0
for x in [1, 2, 3]:
    sum = sum + x

print(sum)  # 6
print(x) # Error: "x" only exists inside the loop
```

### 10.2 While Loops

While loops repeat while a condition is true.

```python
# Basic while loop
let mut counter = 0
while counter < 5:
    counter = counter + 1
    print(counter)

# With break
let mut x = 0
while true:
    x = x + 1
    if x > 10:
        break

# With continue
let mut x = 0
while x < 5:
    x = x + 1
    if x == 2:
        continue
    print(x)
```

#### Loop Keywords
- `break` - Exit the loop immediately
- `continue` - Skip to the next iteration

```python
# Break example
for x in [1, 2, 3, 4, 5]:
    if x == 3:
        break
    print(x)  # Prints: 1, 2

# Continue example
for x in [1, 2, 3, 4, 5]:
    if x == 2:
        continue
    print(x)  # Prints: 1, 3, 4, 5
```

---

## 11. Modules and Imports

Arix uses ES Modules (ESM) for JavaScript interoperability. Each `.arix` file is a module.

### 11.1 File Naming Convention
- Files use **kebab-case**: `user-service.arix`, `my-utils.arix`
- Module name derives from filename: `user-service.arix` → `user-service`

### 11.2 Import Syntax
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

### 11.3 Module Resolution
```
1. Relative imports (./foo, ../foo) → ./foo.arix
2. Named imports (foo-bar) → {src,root}/foo-bar.arix
3. Stdlib (result, option, list) → built-in runtime
```

### 11.4 Visibility
```python
# Private (default) - file only
fn helper() = ...

# Internal - not yet implemented
# internal fn internalFunc() = ...

# Public - exported
public fn publicFunc() = ...
```

### 11.5 Compilation
```bash
# Compile single file (resolves and compiles dependencies)
arix build src/main.arix -o dist/

# Compile to single bundle
arix build src/main.arix -o dist/bundle.js

# Output structure
dist/
├── main.js
├── user-service.js
└── helper-utils.js
```

### 11.6 Example Project Structure
```
project/
├── src/
│   ├── main.arix
│   ├── user-service.arix
│   └── helper-utils.arix
└── dist/
    ├── main.js
    ├── user-service.js
    └── helper-utils.js
```

---

## 12. Error Handling

### 12.1 Option Type
```python
type Option(a) = Some(a) | None

fn findUser(id Int) Option(User) = ...
```

### 12.2 Result Type
```python
type Result(a, e) = Ok(a) | Err(e)

fn parseInt(s String) Result(Int, String) = ...
```

### 12.3 Async Error Handling
```python
async fn fetchUser(id Int) Result(User, String) =
    try await http.get("/api/users/${id}")
    catch e:
        Err(e.message)
```

---

## 13. Documentation

### 13.1 Docstrings
```python
"""
Calculates the area of a shape.
Returns the value in square units.
"""
fn area(shape Shape) Float = ...
```

### 13.2 Type Annotations
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

## 14. Reserved Keywords
```
fn, let, let mut, if, else, match, when, import, type,
public, internal, async, await, try, catch, throw,
return, yield, as, in, for, while, loop, break, continue,
true, false, None, Ok, Err, Some, module, where, use,
typeclass, impl
```

---

## 15. Examples

### 15.1 Hello World
```python
fn main() =
    let name = "World"
    print("Hello, ${name}!")
```

### 15.2 Functional Pipeline
```python
fn processNumbers(nums List(Int)) Int =
    nums
        |> map(* 2)
        |> filter(> 0)
        |> reduce(0, +)

public fn main() =
    let result = processNumbers([1, -2, 3, -4, 5])
    print(result)  # 16
```

### 15.3 Pattern Matching
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

### 15.4 Typeclasses
```python
typeclass Show(a)
  show(x a) -> String

impl Show for Int
  show(x) = x.toString()

impl Show for String
  show(x) = x

fn display(x) where Show(x) =
  print(show(x))

display(42)        # "42"
display("hello")   # "hello"
```

### 15.5 Async/Await
```python
async fn fetchUserData(id Int) Result(User, String) =
    let response = await http.get("/api/users/${id}")
    match response:
        Ok(r) if r.ok -> Ok(toJson(r))
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
fnDecl        ::= ['public' | 'internal'] 'async'? 'fn' pattern params? ['->' type] ['where' constraints] '=' expr
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

typeclassDecl ::= 'typeclass' ident '(' typeParams ')' [constraints] methodDecl*
methodDecl    ::= ident params '->' type ['=' expr]
instanceDecl  ::= 'impl' ident ['for' '(' typeList ')'] ['where' constraints] methodImpl*
constraints   ::= 'where' constraint (',' constraint)*
constraint    ::= ident '(' type (',' type)* ')'
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

| Feature | Python | Arix |
|---------|--------|------|
| Immutability | opt-in with frozen | default |
| Currying | via libraries | built-in |
| Pattern matching | match-case (limited) | full PM |
| Type system | dynamic + TypeGuard | strong static |
| Null | None | Option/Result |
| Pipe | \|> (3.10+) | native |
| Typeclasses | ABC/Protocols | native typeclasses |

---

*Version: 1.0-draft*
*Last Updated: 2026-04-27*
