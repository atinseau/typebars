# Built-in & Custom Helpers

> **[← Back to README](../README.md)** | **Related:** [Templates](templates.md) · [Static Analysis](static-analysis.md) · [Execution](execution.md) · [API Reference](api-reference.md)

Typebars pre-registers a comprehensive set of helpers on every engine instance: **math**, **logical/comparison**, and **map** helpers. All are fully integrated with the static analyzer — argument types are validated, missing properties are caught, and the output schema is correctly inferred.

You can also register your own **custom helpers** with type metadata for full static analysis support.

---

## Table of Contents

- [Math Helpers](#math-helpers)
  - [Named Operators](#named-operators)
  - [Unary Functions](#unary-functions)
  - [Generic `math` Helper](#generic-math-helper)
  - [Static Analysis of Math Helpers](#static-analysis-of-math-helpers)
- [Logical & Comparison Helpers](#logical--comparison-helpers)
  - [Why Sub-Expressions?](#why-sub-expressions)
  - [Comparison Helpers](#comparison-helpers)
  - [Equality Helpers](#equality-helpers)
  - [Logical Operators](#logical-operators)
  - [Collection Helpers](#collection-helpers)
  - [Generic `compare` Helper](#generic-compare-helper)
  - [Nested Sub-Expressions](#nested-sub-expressions)
  - [Static Analysis of Sub-Expressions](#static-analysis-of-sub-expressions)
- [Map Helper](#map-helper)
  - [Basic Usage](#basic-usage)
  - [Chaining](#chaining)
  - [Static Analysis of Map](#static-analysis-of-map)
- [Custom Helpers](#custom-helpers)
  - [`registerHelper`](#registerhelper)
  - [`defineHelper` (Type-Safe)](#definehelper-type-safe)
  - [Helper Management](#helper-management)

---

## Math Helpers

Pre-registered on every `Typebars` instance. All return `{ type: "number" }` for static analysis.

### Named Operators

Binary operators that take two numeric arguments:

| Helper | Aliases | Usage | Example |
|--------|---------|-------|---------|
| `add` | — | `{{add a b}}` | `{{add price tax}}` → 121 |
| `subtract` | `sub` | `{{sub a b}}` | `{{sub price discount}}` → 80 |
| `multiply` | `mul` | `{{mul a b}}` | `{{mul price quantity}}` → 300 |
| `divide` | `div` | `{{div a b}}` | `{{div total count}}` → 33.3 |
| `modulo` | `mod` | `{{mod a b}}` | `{{mod 10 3}}` → 1 |
| `pow` | — | `{{pow a b}}` | `{{pow 2 10}}` → 1024 |
| `min` | — | `{{min a b}}` | `{{min a b}}` → smaller |
| `max` | — | `{{max a b}}` | `{{max a b}}` → larger |

### Unary Functions

Functions that take a single numeric argument (and an optional second parameter for `round`):

| Helper | Usage | Description |
|--------|-------|-------------|
| `abs` | `{{abs value}}` | Absolute value |
| `ceil` | `{{ceil value}}` | Round up |
| `floor` | `{{floor value}}` | Round down |
| `round` | `{{round value [precision]}}` | Round with optional decimal places |
| `sqrt` | `{{sqrt value}}` | Square root |

```ts
engine.execute("{{round pi 2}}", { pi: 3.14159 }); // → 3.14
engine.execute("{{abs value}}", { value: -7 });      // → 7
```

Math helpers work with [array `.length` intrinsic](schema-features.md#array-length-intrinsic):

```ts
engine.execute("{{div items.length count}}", { items: [1, 2, 3, 4, 5], count: 2 });
// → 2.5
```

### Generic `math` Helper

Inline arithmetic with the operator as a string:

```ts
engine.execute('{{math a "+" b}}', { a: 10, b: 3 });   // → 13
engine.execute('{{math a "*" b}}', { a: 10, b: 3 });   // → 30
engine.execute('{{math a "**" b}}', { a: 2, b: 10 });  // → 1024
```

Supported operators: `+`, `-`, `*`, `/`, `%`, `**`

### Static Analysis of Math Helpers

All math helpers validate that parameters resolve to `{ type: "number" }` and infer `{ type: "number" }` as output:

```ts
const schema = {
  type: "object",
  properties: {
    a: { type: "number" },
    b: { type: "number" },
    label: { type: "string" },
  },
};

// ✅ Valid
const { analysis, value } = engine.analyzeAndExecute(
  "{{add a b}}",
  schema,
  { a: 10, b: 3 },
);
analysis.outputSchema; // → { type: "number" }
value;                 // → 13

// ⚠️ Type mismatch on parameter
const { analysis: a2 } = engine.analyzeAndExecute(
  "{{add a label}}",
  schema,
  { a: 10, label: "hello" },
);
// a2.valid → false (string passed to a number parameter)
```

---

## Logical & Comparison Helpers

Pre-registered on every `Typebars` instance. All return `{ type: "boolean" }` for static analysis.

These helpers enable **conditional logic** inside templates via Handlebars [sub-expressions](https://handlebarsjs.com/guide/subexpressions.html) — the `(helper arg1 arg2)` syntax used as arguments to [block helpers](templates.md#block-helpers) like `{{#if}}` and `{{#unless}}`.

### Why Sub-Expressions?

Standard Handlebars only supports simple truthiness checks:

```handlebars
{{!-- Native Handlebars: can only test if "active" is truthy --}}
{{#if active}}yes{{else}}no{{/if}}
```

There is **no built-in way** to compare values, combine conditions, or negate expressions. Handlebars deliberately delegates this to helpers.

Typebars ships a complete set of logical and comparison helpers that unlock expressive conditions out of the box:

```handlebars
{{!-- Typebars: compare, combine, negate — all statically analyzed --}}
{{#if (gt age 18)}}adult{{else}}minor{{/if}}
{{#if (and active (eq role "admin"))}}full access{{/if}}
{{#if (not suspended)}}welcome{{/if}}
```

These helpers are **fully integrated with the static analyzer**: argument types are validated, missing properties are caught, and the [output schema](static-analysis.md#single-block--branch-type-inference) is correctly inferred from the branches — not from the boolean condition.

### Comparison Helpers

| Helper | Aliases | Usage | Description |
|--------|---------|-------|-------------|
| `lt` | — | `(lt a b)` | `a < b` (numeric) |
| `lte` | `le` | `(lte a b)` | `a <= b` (numeric) |
| `gt` | — | `(gt a b)` | `a > b` (numeric) |
| `gte` | `ge` | `(gte a b)` | `a >= b` (numeric) |

Both parameters must resolve to `{ type: "number" }`. A type mismatch is reported as an error:

```ts
const schema = {
  type: "object",
  properties: {
    age: { type: "number" },
    score: { type: "number" },
    name: { type: "string" },
    account: {
      type: "object",
      properties: { balance: { type: "number" } },
    },
  },
};

// ✅ Both arguments are numbers
engine.analyze("{{#if (lt age 18)}}minor{{else}}adult{{/if}}", schema);
// valid: true, no diagnostics

// ✅ Nested property access works
engine.analyze("{{#if (lt account.balance 500)}}low{{else}}ok{{/if}}", schema);
// valid: true

// ✅ Number literals are accepted
engine.analyze("{{#if (gte score 90)}}A{{else}}B{{/if}}", schema);
// valid: true

// ❌ String where number is expected → TYPE_MISMATCH
engine.analyze("{{#if (lt name 500)}}yes{{/if}}", schema);
// valid: false — "name" is string, "lt" expects number
```

### Equality Helpers

| Helper | Aliases | Usage | Description |
|--------|---------|-------|-------------|
| `eq` | — | `(eq a b)` | Strict equality (`===`) |
| `ne` | `neq` | `(ne a b)` | Strict inequality (`!==`) |

These accept any type — no type constraint on parameters:

```ts
// String comparison
engine.execute('{{#if (eq role "admin")}}yes{{else}}no{{/if}}', { role: "admin" });
// → "yes"

// Number comparison
engine.execute("{{#if (ne score 0)}}scored{{else}}zero{{/if}}", { score: 85 });
// → "scored"
```

### Logical Operators

| Helper | Usage | Description |
|--------|-------|-------------|
| `not` | `(not value)` | Logical negation — `true` if value is falsy |
| `and` | `(and a b)` | Logical AND — `true` if both are truthy |
| `or` | `(or a b)` | Logical OR — `true` if at least one is truthy |

```ts
engine.execute("{{#if (not active)}}inactive{{else}}active{{/if}}", { active: false });
// → "inactive"

engine.execute(
  "{{#if (and active premium)}}VIP{{else}}standard{{/if}}",
  { active: true, premium: true },
);
// → "VIP"

engine.execute(
  "{{#if (or isAdmin isModerator)}}staff{{else}}user{{/if}}",
  { isAdmin: false, isModerator: true },
);
// → "staff"
```

### Collection Helpers

| Helper | Usage | Description |
|--------|-------|-------------|
| `contains` | `(contains haystack needle)` | `true` if the string contains the substring, or the array contains the element |
| `in` | `(in value ...candidates)` | `true` if value is one of the candidates (variadic) |

```ts
engine.execute(
  '{{#if (contains name "ali")}}match{{else}}no match{{/if}}',
  { name: "Alice" },
);
// → "match"

engine.execute(
  '{{#if (in status "active" "pending")}}ok{{else}}blocked{{/if}}',
  { status: "active" },
);
// → "ok"
```

### Generic `compare` Helper

A single helper with the operator as a string parameter:

```ts
engine.execute('{{#if (compare a "<" b)}}yes{{else}}no{{/if}}', { a: 3, b: 10 });
// → "yes"

engine.execute('{{#if (compare name "===" "Alice")}}hi Alice{{/if}}', { name: "Alice" });
// → "hi Alice"
```

Supported operators: `==`, `===`, `!=`, `!==`, `<`, `<=`, `>`, `>=`

### Nested Sub-Expressions

Sub-expressions can be **nested** to build complex conditions. Each level is fully analyzed:

```ts
// AND + comparison
engine.execute(
  '{{#if (and (eq role "admin") (gt score 90))}}top admin{{else}}other{{/if}}',
  { role: "admin", score: 95 },
);
// → "top admin"

// OR + NOT
engine.execute(
  "{{#if (or (not active) (lt score 10))}}alert{{else}}ok{{/if}}",
  { active: true, score: 85 },
);
// → "ok"

// Deeply nested
engine.execute(
  '{{#if (and (or (lt age 18) (gt age 65)) (eq role "special"))}}discount{{else}}full price{{/if}}',
  { age: 70, role: "special" },
);
// → "discount"
```

### Static Analysis of Sub-Expressions

Sub-expressions are **fully integrated** with the static analyzer. The key behaviors:

**1. Argument validation** — every argument is resolved against the schema:

```ts
// ❌ Unknown property in sub-expression argument
engine.analyze("{{#if (lt nonExistent 500)}}yes{{/if}}", schema);
// valid: false — UNKNOWN_PROPERTY

// ❌ Missing nested property
engine.analyze("{{#if (lt account.foo 500)}}yes{{/if}}", schema);
// valid: false — UNKNOWN_PROPERTY

// ❌ Too few arguments
engine.analyze("{{#if (lt age)}}yes{{/if}}", schema);
// valid: false — MISSING_ARGUMENT
```

**2. Type checking** — parameter types are validated against helper declarations:

```ts
// ❌ String where number is expected
engine.analyze("{{#if (lt name 500)}}yes{{/if}}", schema);
// valid: false — TYPE_MISMATCH: "lt" parameter "a" expects number, got string
```

**3. Output type inference** — the output schema is based on the **branches**, not the condition:

```ts
// The condition (lt ...) returns boolean, but the output type
// comes from the branch content:

engine.analyze("{{#if (lt age 18)}}{{name}}{{else}}{{age}}{{/if}}", schema).outputSchema;
// → { oneOf: [{ type: "string" }, { type: "number" }] }
// (NOT boolean — the condition type doesn't leak into the output)

engine.analyze("{{#if (gt score 50)}}{{age}}{{else}}{{score}}{{/if}}", schema).outputSchema;
// → { type: "number" }
// (both branches are number → simplified to single type)

engine.analyze("{{#if (eq age 18)}}42{{else}}true{{/if}}", schema).outputSchema;
// → { oneOf: [{ type: "number" }, { type: "boolean" }] }

// Chained else-if pattern
engine.analyze(
  "{{#if (lt age 18)}}minor{{else}}{{#if (lt age 65)}}adult{{else}}senior{{/if}}{{/if}}",
  schema,
).outputSchema;
// → { type: "string" }
// (all branches are string literals → simplified)
```

**4. Unknown helpers** — unregistered helpers emit a warning (not an error):

```ts
engine.analyze("{{#if (myCustomCheck age)}}yes{{/if}}", schema);
// valid: true, but 1 warning: UNKNOWN_HELPER "myCustomCheck"
```

---

## Map Helper

The `map` helper extracts a specific property from each element of an array, returning a new array of those values. It is pre-registered on every `Typebars` instance.

### Basic Usage

```ts
const data = {
  users: [
    { name: "Alice", age: 30 },
    { name: "Bob", age: 25 },
    { name: "Charlie", age: 35 },
  ],
};

engine.execute('{{map users "name"}}', data);
// → ["Alice", "Bob", "Charlie"]

engine.execute('{{map users "age"}}', data);
// → [30, 25, 35]
```

The first argument must be an array of objects, and the second argument must be a **quoted string literal** (the property name to extract).

> **Type preservation:** In [single expression mode](execution.md#single-expression), `map` returns a raw array. In a mixed template, the array is joined with `", "` into a string.

### Chaining

The `map` helper can be chained via sub-expressions to drill into nested arrays:

```ts
const data = {
  users: [
    { name: "Alice", cartItems: [{ productId: "P1" }, { productId: "P2" }] },
    { name: "Bob", cartItems: [{ productId: "P3" }] },
  ],
};

// First map extracts cartItems (array of arrays), then second map extracts productId
engine.execute('{{map (map users "cartItems") "productId"}}', data);
// → ["P1", "P2", "P3"]
```

The inner `map` returns arrays of `cartItems` which are flattened one level before the outer `map` extracts `productId`.

### Static Analysis of Map

The `map` helper has special static analysis handling:

- The first argument must resolve to an array of objects
- The second argument must be a quoted string literal (e.g. `"name"`, not `name`)
- The property must exist in the item schema of the array
- The inferred return type is `{ type: "array", items: <property schema> }`

```ts
const schema = {
  type: "object",
  properties: {
    users: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          age:  { type: "number" },
        },
      },
    },
  },
};

// ✅ Valid — "name" exists in the item schema
engine.analyze('{{map users "name"}}', schema);
// → valid: true, outputSchema: { type: "array", items: { type: "string" } }

// ✅ Number property
engine.analyze('{{map users "age"}}', schema);
// → valid: true, outputSchema: { type: "array", items: { type: "number" } }
```

---

## Custom Helpers

### `registerHelper`

Register a custom helper with type metadata for static analysis:

```ts
const engine = new Typebars();

engine.registerHelper("uppercase", {
  fn: (value) => String(value).toUpperCase(),
  params: [
    { name: "value", type: { type: "string" }, description: "The string to convert" },
  ],
  returnType: { type: "string" },
  description: "Converts to UPPERCASE",
});

// Execution
engine.execute("{{uppercase name}}", { name: "alice" });
// → "ALICE"

// Static analysis uses the declared returnType
engine.analyze("{{uppercase name}}", {
  type: "object",
  properties: { name: { type: "string" } },
}).outputSchema;
// → { type: "string" }
```

Helpers can also be passed at construction time:

```ts
const engine = new Typebars({
  helpers: [
    {
      name: "uppercase",
      fn: (value) => String(value).toUpperCase(),
      params: [{ name: "value", type: { type: "string" } }],
      returnType: { type: "string" },
    },
    {
      name: "double",
      fn: (value) => Number(value) * 2,
      params: [{ name: "value", type: { type: "number" } }],
      returnType: { type: "number" },
    },
  ],
});
```

`registerHelper` returns `this` for chaining:

```ts
engine
  .registerHelper("upper", { fn: (v) => String(v).toUpperCase(), returnType: { type: "string" } })
  .registerHelper("lower", { fn: (v) => String(v).toLowerCase(), returnType: { type: "string" } });
```

### `defineHelper` (Type-Safe)

`defineHelper()` infers the TypeScript types of your `fn` arguments from the JSON Schemas declared in `params`. This gives you full type safety in the helper implementation:

```ts
import { Typebars, defineHelper } from "typebars";

const concatHelper = defineHelper({
  name: "concat",
  description: "Concatenates two strings",
  params: [
    { name: "a", type: { type: "string" }, description: "First string" },
    { name: "b", type: { type: "string" }, description: "Second string" },
    { name: "sep", type: { type: "string" }, description: "Separator", optional: true },
  ] as const,
  fn: (a, b, sep) => {
    // TypeScript infers: a: string, b: string, sep: string | undefined
    return `${a}${sep ?? ""}${b}`;
  },
  returnType: { type: "string" },
});

const engine = new Typebars({ helpers: [concatHelper] });
```

> **`as const`** on the `params` array is required for TypeScript to infer the parameter types correctly.

### Helper Management

| Method | Description |
|--------|-------------|
| `registerHelper(name, definition)` | Register a custom helper. Returns `this` for chaining |
| `unregisterHelper(name)` | Remove a helper (including built-in ones). Returns `this` |
| `hasHelper(name)` | Check if a helper is registered. Returns `boolean` |

```ts
engine.hasHelper("add");        // true (built-in)
engine.hasHelper("uppercase");  // false (not registered)

engine.registerHelper("uppercase", { /* ... */ });
engine.hasHelper("uppercase");  // true

engine.unregisterHelper("uppercase");
engine.hasHelper("uppercase");  // false
```

> **Note:** Unregistering a helper invalidates the compilation cache to ensure templates are recompiled without the removed helper.

---

## Summary of Built-in Helpers

| Category | Helpers | Output Schema |
|----------|---------|---------------|
| **Math (binary)** | `add`, `sub`, `mul`, `div`, `mod`, `pow`, `min`, `max` | `{ type: "number" }` |
| **Math (unary)** | `abs`, `ceil`, `floor`, `round`, `sqrt` | `{ type: "number" }` |
| **Math (generic)** | `math` | `{ type: "number" }` |
| **Comparison** | `lt`, `lte`/`le`, `gt`, `gte`/`ge` | `{ type: "boolean" }` |
| **Equality** | `eq`, `ne`/`neq` | `{ type: "boolean" }` |
| **Logical** | `not`, `and`, `or` | `{ type: "boolean" }` |
| **Collection** | `contains`, `in` | `{ type: "boolean" }` |
| **Generic compare** | `compare` | `{ type: "boolean" }` |
| **Map** | `map` | `{ type: "array", items: <resolved> }` |

---

## What's Next?

- **[Templates](templates.md)** — use helpers inside block helpers and templates
- **[Static Analysis](static-analysis.md)** — how helper arguments and return types are validated
- **[Template Identifiers](identifiers.md)** — the `{{key:N}}` syntax for multi-source pipelines
- **[API Reference](api-reference.md)** — full `HelperDefinition` and `HelperConfig` types