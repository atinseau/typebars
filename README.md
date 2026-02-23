# Typebars

**Type-safe Handlebars template engine with static analysis powered by JSON Schema.**

Typebars wraps Handlebars with a static analysis layer that validates your templates against a JSON Schema **before execution**. Given an input schema describing your data, Typebars detects unknown properties, type mismatches, and missing arguments at analysis time — and infers the exact JSON Schema of the template's output.

```ts
import { Typebars } from "typebars";

const engine = new Typebars();

const inputSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age:  { type: "number" },
  },
  required: ["name", "age"],
};

// Analyze: validates the template against the input schema
// and infers the output schema
const { valid, diagnostics, outputSchema } = engine.analyze(
  "Hello {{name}}, you are {{age}}!",
  inputSchema,
);

valid;        // true — every referenced variable exists in the schema
outputSchema; // { type: "string" } — mixed template always produces a string

// Now analyze a single expression
const result = engine.analyze("{{age}}", inputSchema);
result.outputSchema; // { type: "number" } — inferred from the input schema

```

The output schema is inferred **statically** from the template structure and the input schema — no data is needed.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Static Analysis — Input Validation](#static-analysis--input-validation)
  - [Property Validation](#property-validation)
  - [Nested Properties (Dot Notation)](#nested-properties-dot-notation)
  - [Validation Inside Block Helpers](#validation-inside-block-helpers)
  - [Diagnostics](#diagnostics)
- [Static Analysis — Output Schema Inference](#static-analysis--output-schema-inference)
  - [Single Expression → Resolved Type](#single-expression--resolved-type)
  - [Mixed Template → String](#mixed-template--string)
  - [Single Block → Branch Type Inference](#single-block--branch-type-inference)
  - [Object Templates → Object Schema](#object-templates--object-schema)
  - [Literal Inputs → Primitive Schema](#literal-inputs--primitive-schema)
- [Schema Features](#schema-features)
  - [`$ref` Resolution](#ref-resolution)
  - [Combinators (`allOf`, `anyOf`, `oneOf`)](#combinators-allof-anyof-oneof)
  - [`additionalProperties`](#additionalproperties)
  - [Array `.length` Intrinsic](#array-length-intrinsic)
- [Execution & Type Preservation](#execution--type-preservation)
- [Compiled Templates](#compiled-templates)
- [Object Templates](#object-templates)
- [Block Helpers](#block-helpers)
  - [`{{#if}}` / `{{#unless}}`](#if--unless)
  - [`{{#each}}`](#each)
  - [`{{#with}}`](#with)
- [Built-in Math Helpers](#built-in-math-helpers)
- [Built-in Logical & Comparison Helpers](#built-in-logical--comparison-helpers)
  - [Why Sub-Expressions?](#why-sub-expressions)
  - [Comparison Helpers](#comparison-helpers)
  - [Equality Helpers](#equality-helpers)
  - [Logical Operators](#logical-operators)
  - [Collection Helpers](#collection-helpers)
  - [Generic `compare` Helper](#generic-compare-helper)
  - [Nested Sub-Expressions](#nested-sub-expressions)
  - [Static Analysis of Sub-Expressions](#static-analysis-of-sub-expressions)
- [Custom Helpers](#custom-helpers)
  - [`registerHelper`](#registerhelper)
  - [`defineHelper` (Type-Safe)](#definehelper-type-safe)
- [Template Identifiers (`{{key:N}}`)](#template-identifiers-keyn)
- [Error Handling](#error-handling)
- [Configuration & API Reference](#configuration--api-reference)

---

## Installation

```sh
npm install typebars
# or
yarn add typebars
# or
pnpm add typebars
# or
bun add typebars
```

**Peer dependency:** TypeScript ≥ 5

---

## Quick Start

```ts
import { Typebars } from "typebars";

const engine = new Typebars();

const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age:  { type: "number" },
  },
  required: ["name", "age"],
};

const data = { name: "Alice", age: 30 };

// 1. Analyze — validate + infer output type
const analysis = engine.analyze("Hello {{name}}", schema);
// analysis.valid        → true
// analysis.outputSchema → { type: "string" }

// 2. Execute — render the template
const result = engine.execute("Hello {{name}}", data);
// result → "Hello Alice"

// 3. Or do both at once
const { analysis: a, value } = engine.analyzeAndExecute("{{age}}", schema, data);
// a.outputSchema → { type: "number" }
// value          → 30
```

---

## How It Works

Typebars operates in three phases:

```
                     ┌────────────────────────────────────────────┐
                     │              Input Schema                  │
                     │  (JSON Schema describing available data)   │
                     └──────────────────┬─────────────────────────┘
                                        │
┌──────────────┐    ┌───────────────────▼─────────────────────────┐
│   Template   │───▶│            Static Analyzer                  │
│  (string)    │    │                                             │
└──────────────┘    │  1. Validates every {{expression}} against  │
                    │     the input schema                        │
                    │  2. Validates block helper usage (#if on     │
                    │     existing property, #each on arrays...)  │
                    │  3. Infers the output JSON Schema from the  │
                    │     template structure                      │
                    │                                             │
                    └──────┬───────────────────┬──────────────────┘
                           │                   │
              ┌────────────▼──┐     ┌──────────▼──────────┐
              │  Diagnostics  │     │   Output Schema     │
              │  (errors,     │     │   (JSON Schema of   │
              │   warnings)   │     │    the return value) │
              └───────────────┘     └─────────────────────┘
```

The **input schema** describes what variables are available. The **output schema** describes what the template will produce. The analyzer derives the output from the input — purely statically, without executing anything.

---

## Static Analysis — Input Validation

### Property Validation

Every `{{expression}}` in the template is validated against the input schema. If a property doesn't exist, Typebars reports an error with the available properties:

```ts
const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age:  { type: "number" },
  },
};

// ✅ Valid — "name" exists in the schema
engine.analyze("{{name}}", schema);
// → { valid: true, diagnostics: [] }

// ❌ Invalid — "firstName" does not exist
engine.analyze("{{firstName}}", schema);
// → {
//   valid: false,
//   diagnostics: [{
//     severity: "error",
//     code: "UNKNOWN_PROPERTY",
//     message: 'Property "firstName" does not exist in the context schema. Available properties: age, name',
//     details: { path: "firstName", availableProperties: ["age", "name"] }
//   }]
// }

// Multiple errors are reported at once
engine.analyze("{{foo}} and {{bar}}", schema);
// → 2 diagnostics, one for "foo" and one for "bar"
```

### Nested Properties (Dot Notation)

Dot notation is validated at every depth level:

```ts
const schema = {
  type: "object",
  properties: {
    address: {
      type: "object",
      properties: {
        city: { type: "string" },
        zip:  { type: "string" },
      },
    },
    metadata: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["admin", "user", "guest"] },
      },
    },
  },
};

// ✅ Valid — full path resolved
engine.analyze("{{address.city}}", schema);   // valid: true
engine.analyze("{{metadata.role}}", schema);  // valid: true

// ❌ Invalid — "country" doesn't exist inside "address"
engine.analyze("{{address.country}}", schema);
// → error: Property "address.country" does not exist
```

### Validation Inside Block Helpers

The analyzer walks **into** block helpers and validates every expression in every branch:

```ts
const schema = {
  type: "object",
  properties: {
    active: { type: "boolean" },
    name:   { type: "string" },
    tags:   { type: "array", items: { type: "string" } },
    orders: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id:      { type: "number" },
          product: { type: "string" },
        },
      },
    },
    address: {
      type: "object",
      properties: {
        city: { type: "string" },
      },
    },
  },
};

// ✅ #if — validates the condition AND both branches
engine.analyze("{{#if active}}{{name}}{{else}}unknown{{/if}}", schema);
// valid: true

// ❌ #if — invalid properties inside branches are caught
engine.analyze("{{#if active}}{{badProp1}}{{else}}{{badProp2}}{{/if}}", schema);
// valid: false — 2 errors (one per branch)

// ❌ #if — invalid condition is caught
engine.analyze("{{#if nonexistent}}yes{{/if}}", schema);
// valid: false — "nonexistent" doesn't exist

// ✅ #each — validates that the target is an array, then validates
//    the body against the item schema
engine.analyze("{{#each orders}}{{product}} #{{id}}{{/each}}", schema);
// valid: true — "product" and "id" exist in the item schema

// ❌ #each — property doesn't exist in the item schema
engine.analyze("{{#each orders}}{{badField}}{{/each}}", schema);
// valid: false — "badField" doesn't exist in order items

// ❌ #each — target is not an array
engine.analyze("{{#each name}}{{this}}{{/each}}", schema);
// valid: false — TYPE_MISMATCH: "{{#each}}" expects array, got "string"

// ✅ #with — changes context to a sub-object, validates inner expressions
engine.analyze("{{#with address}}{{city}}{{/with}}", schema);
// valid: true

// ❌ #with — property doesn't exist in the sub-context
engine.analyze("{{#with address}}{{country}}{{/with}}", schema);
// valid: false — "country" doesn't exist inside "address"

// ✅ Nested blocks — validated at every level
engine.analyze(
  "{{#with address}}{{city}}{{/with}} — {{#each tags}}{{this}}{{/each}}",
  schema,
);
// valid: true
```

**Key insight:** `{{#each}}` changes the schema context to the array's `items` schema. Inside `{{#each orders}}`, the context becomes `{ type: "object", properties: { id, product } }`. Inside `{{#each tags}}`, the context becomes `{ type: "string" }` and `{{this}}` refers to each string element.

`{{#with}}` changes the schema context to the resolved sub-object schema. Inside `{{#with address}}`, the context becomes the schema of `address`.

### Diagnostics

Every diagnostic is a structured object with machine-readable fields:

```ts
interface TemplateDiagnostic {
  severity: "error" | "warning";
  code: DiagnosticCode;
  message: string;
  loc?: {
    start: { line: number; column: number };
    end:   { line: number; column: number };
  };
  source?: string;
  details?: {
    path?: string;
    helperName?: string;
    expected?: string;
    actual?: string;
    availableProperties?: string[];
    identifier?: number;
  };
}
```

Available diagnostic codes:

| Code | Severity | Description |
|------|----------|-------------|
| `UNKNOWN_PROPERTY` | error | Property doesn't exist in the schema |
| `TYPE_MISMATCH` | error | Incompatible type (e.g. `{{#each}}` on a non-array) |
| `MISSING_ARGUMENT` | error | Block helper used without required argument |
| `UNKNOWN_HELPER` | warning | Unknown block helper |
| `UNANALYZABLE` | warning | Expression can't be statically analyzed |
| `MISSING_IDENTIFIER_SCHEMAS` | error | `{{key:N}}` used but no identifier schemas provided |
| `UNKNOWN_IDENTIFIER` | error | Identifier N not found in identifier schemas |
| `IDENTIFIER_PROPERTY_NOT_FOUND` | error | Property doesn't exist in identifier's schema |
| `PARSE_ERROR` | error | Invalid Handlebars syntax |

---

## Static Analysis — Output Schema Inference

This is where Typebars shines. Given a template and an input schema, Typebars **infers the JSON Schema of the output value**. The inferred type depends on the template structure.

### Single Expression → Resolved Type

When the template is a single `{{expression}}` (with optional whitespace around it), the output schema is the resolved type from the input schema:

```ts
const schema = {
  type: "object",
  properties: {
    name:    { type: "string" },
    age:     { type: "number" },
    score:   { type: "integer" },
    active:  { type: "boolean" },
    address: {
      type: "object",
      properties: {
        city: { type: "string" },
        zip:  { type: "string" },
      },
    },
    tags: {
      type: "array",
      items: { type: "string" },
    },
    role: { type: "string", enum: ["admin", "user", "guest"] },
  },
};

engine.analyze("{{name}}", schema).outputSchema;
// → { type: "string" }

engine.analyze("{{age}}", schema).outputSchema;
// → { type: "number" }

engine.analyze("{{score}}", schema).outputSchema;
// → { type: "integer" }

engine.analyze("{{active}}", schema).outputSchema;
// → { type: "boolean" }

engine.analyze("{{address}}", schema).outputSchema;
// → { type: "object", properties: { city: { type: "string" }, zip: { type: "string" } } }

engine.analyze("{{tags}}", schema).outputSchema;
// → { type: "array", items: { type: "string" } }

// Dot notation resolves to the leaf type
engine.analyze("{{address.city}}", schema).outputSchema;
// → { type: "string" }

// Enums are preserved
engine.analyze("{{role}}", schema).outputSchema;
// → { type: "string", enum: ["admin", "user", "guest"] }

// Whitespace around a single expression is ignored
engine.analyze("  {{age}}  ", schema).outputSchema;
// → { type: "number" }
```

**This is the key mechanism**: the output schema is **derived from** the input schema by resolving the expression path. `{{age}}` in a schema where `age` is `{ type: "number" }` produces an output schema of `{ type: "number" }`.

### Mixed Template → String

When a template contains text **and** expressions, or multiple expressions, the output is always `{ type: "string" }` — because Handlebars concatenates everything into a string:

```ts
engine.analyze("Hello {{name}}", schema).outputSchema;
// → { type: "string" }

engine.analyze("{{name}} ({{age}})", schema).outputSchema;
// → { type: "string" }

engine.analyze("Just plain text", schema).outputSchema;
// → { type: "string" }
```

### Single Block → Branch Type Inference

When the template is a **single block** (optionally surrounded by whitespace), Typebars infers the type from the block's branches:

```ts
// Both branches are numeric literals → output is number
engine.analyze("{{#if active}}10{{else}}20{{/if}}", schema).outputSchema;
// → { type: "number" }

// Both branches are booleans → output is boolean
engine.analyze("{{#if active}}true{{else}}false{{/if}}", schema).outputSchema;
// → { type: "boolean" }

// Both branches are single expressions of the same type → that type
engine.analyze(
  "{{#if active}}{{name}}{{else}}{{address.city}}{{/if}}",
  schema,
).outputSchema;
// → { type: "string" }
// (both are string, so the output is string)

// Branches with different types → oneOf union
engine.analyze(
  "{{#if active}}{{age}}{{else}}{{score}}{{/if}}",
  schema,
).outputSchema;
// → { oneOf: [{ type: "number" }, { type: "integer" }] }

engine.analyze(
  "{{#if active}}42{{else}}hello{{/if}}",
  schema,
).outputSchema;
// → { oneOf: [{ type: "number" }, { type: "string" }] }

// null in one branch → union with null
engine.analyze(
  "{{#if active}}null{{else}}fallback{{/if}}",
  schema,
).outputSchema;
// → { oneOf: [{ type: "null" }, { type: "string" }] }

// #unless works the same way
engine.analyze(
  "{{#unless active}}0{{else}}1{{/unless}}",
  schema,
).outputSchema;
// → { type: "number" }

// #with as single block → type of the inner body
engine.analyze("{{#with address}}{{city}}{{/with}}", schema).outputSchema;
// → { type: "string" }

// #each always produces string (concatenation of iterations)
engine.analyze("{{#each tags}}{{this}}{{/each}}", schema).outputSchema;
// → { type: "string" }
```

The inference logic per block type:

| Block | Output Schema |
|-------|---------------|
| `{{#if}}` with else | `oneOf(then_type, else_type)` (simplified if both are equal) |
| `{{#if}}` without else | Type of the then branch |
| `{{#unless}}` | Same as `{{#if}}` (inverted semantics, same type inference) |
| `{{#each}}` | Always `{ type: "string" }` (concatenation) |
| `{{#with}}` | Type of the inner body |

### Object Templates → Object Schema

When you pass an object as a template, each property is analyzed independently and the output schema is an object schema:

```ts
const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age:  { type: "number" },
    city: { type: "string" },
  },
};

const analysis = engine.analyze(
  {
    userName: "Hello {{name}}!",  // mixed → string
    userAge:  "{{age}}",          // single expression → number
    location: "{{city}}",         // single expression → string
  },
  schema,
);

analysis.outputSchema;
// → {
//   type: "object",
//   properties: {
//     userName: { type: "string" },
//     userAge:  { type: "number" },
//     location: { type: "string" },
//   },
//   required: ["userName", "userAge", "location"],
// }
```

Nesting works recursively:

```ts
engine.analyze(
  {
    user: {
      name: "{{name}}",
      age:  "{{age}}",
    },
    meta: {
      active: "{{active}}",
    },
  },
  schema,
).outputSchema;
// → {
//   type: "object",
//   properties: {
//     user: {
//       type: "object",
//       properties: {
//         name: { type: "string" },
//         age:  { type: "number" },
//       },
//       required: ["name", "age"],
//     },
//     meta: {
//       type: "object",
//       properties: {
//         active: { type: "boolean" },
//       },
//       required: ["active"],
//     },
//   },
//   required: ["user", "meta"],
// }
```

If **any** property in the object template is invalid, the entire object is marked as `valid: false` and all diagnostics are collected.

### Literal Inputs → Primitive Schema

Non-string values (`number`, `boolean`, `null`) are treated as passthrough literals. They are always valid (the input schema is ignored) and their output schema is inferred from the value:

```ts
engine.analyze(42, schema).outputSchema;
// → { type: "integer" }

engine.analyze(3.14, schema).outputSchema;
// → { type: "number" }

engine.analyze(true, schema).outputSchema;
// → { type: "boolean" }

engine.analyze(null, schema).outputSchema;
// → { type: "null" }
```

This is useful in object templates where some properties are fixed values:

```ts
engine.analyze(
  {
    name:     "{{name}}",  // → string (from schema)
    version:  42,          // → integer (literal)
    isPublic: true,        // → boolean (literal)
    deleted:  null,        // → null (literal)
  },
  schema,
).outputSchema;
// → {
//   type: "object",
//   properties: {
//     name:     { type: "string" },
//     version:  { type: "integer" },
//     isPublic: { type: "boolean" },
//     deleted:  { type: "null" },
//   },
//   required: ["name", "version", "isPublic", "deleted"],
// }
```

---

## Schema Features

### `$ref` Resolution

Internal `$ref` references (`#/definitions/...`) are resolved transparently:

```ts
const schema = {
  type: "object",
  definitions: {
    Address: {
      type: "object",
      properties: {
        street: { type: "string" },
        city:   { type: "string" },
      },
    },
  },
  properties: {
    home: { $ref: "#/definitions/Address" },
    work: { $ref: "#/definitions/Address" },
  },
};

// ✅ Resolves through $ref
engine.analyze("{{home.city}}", schema);

// → valid: true, outputSchema: { type: "string" }

// ✅ Works with multiple $ref to the same definition
engine.analyze("{{home.city}} — {{work.street}}", schema);
// → valid: true

// ❌ Property doesn't exist behind the $ref
engine.analyze("{{home.zip}}", schema);
// → valid: false — "zip" not found in Address
```

Nested `$ref` (a `$ref` pointing to another `$ref`) is resolved recursively.

### Combinators (`allOf`, `anyOf`, `oneOf`)

Properties defined across combinators are resolved:

```ts
const schema = {
  type: "object",
  allOf: [
    { type: "object", properties: { a: { type: "string" } } },
    { type: "object", properties: { b: { type: "number" } } },
  ],
};

engine.analyze("{{a}}", schema).valid; // true → { type: "string" }
engine.analyze("{{b}}", schema).valid; // true → { type: "number" }
```

`oneOf` and `anyOf` branches are also searched.

### `additionalProperties`

When a property isn't found in `properties` but `additionalProperties` is set:

```ts
// additionalProperties: true → any property is allowed (type unknown)
engine.analyze("{{anything}}", { type: "object", additionalProperties: true });
// → valid: true, outputSchema: {}

// additionalProperties with a schema → resolved to that schema
engine.analyze("{{anything}}", {
  type: "object",
  additionalProperties: { type: "number" },
});
// → valid: true, outputSchema: { type: "number" }

// additionalProperties: false → unknown properties are rejected
engine.analyze("{{anything}}", {
  type: "object",
  properties: { name: { type: "string" } },
  additionalProperties: false,
});
// → valid: false
```

### Array `.length` Intrinsic

Accessing `.length` on an array is valid and inferred as `{ type: "integer" }`:

```ts
const schema = {
  type: "object",
  properties: {
    tags:   { type: "array", items: { type: "string" } },
    orders: { type: "array", items: { type: "object", properties: { id: { type: "number" } } } },
  },
};

engine.analyze("{{tags.length}}", schema).outputSchema;
// → { type: "integer" }

engine.analyze("{{orders.length}}", schema).outputSchema;
// → { type: "integer" }

// .length on a non-array is invalid
engine.analyze("{{name.length}}", {
  type: "object",
  properties: { name: { type: "string" } },
});
// → valid: false, code: UNKNOWN_PROPERTY
```

---

## Execution & Type Preservation

Typebars preserves types at execution time. The behavior depends on the template structure:

| Template Shape | Execution Return Type |
|---|---|
| Single expression `{{expr}}` | Raw value (`number`, `boolean`, `object`, `array`, `null`…) |
| Mixed template `text {{expr}}` | `string` (concatenation) |
| Single block with literal branches | Coerced value (`number`, `boolean`, `null`) |
| Multi-block or mixed | `string` |
| Literal input (`42`, `true`, `null`) | The value as-is |

```ts
const engine = new Typebars();
const data = { name: "Alice", age: 30, active: true, tags: ["ts", "js"] };

// Single expression → raw type
engine.execute("{{age}}", data);     // → 30 (number)
engine.execute("{{active}}", data);  // → true (boolean)
engine.execute("{{tags}}", data);    // → ["ts", "js"] (array)

// Mixed → string
engine.execute("Age: {{age}}", data); // → "Age: 30" (string)

// Single block with literal branches → coerced
engine.execute("{{#if active}}42{{else}}0{{/if}}", data);       // → 42 (number)
engine.execute("{{#if active}}true{{else}}false{{/if}}", data); // → true (boolean)

// Literal passthrough
engine.execute(42, data);   // → 42
engine.execute(true, data); // → true
engine.execute(null, data); // → null
```

This means the **output schema** inferred at analysis time matches the actual runtime value type.

---

## Compiled Templates

For templates executed multiple times, `compile()` parses the template once and returns a reusable `CompiledTemplate`:

```ts
const engine = new Typebars();
const tpl = engine.compile("Hello {{name}}!");

// No re-parsing — execute many times
tpl.execute({ name: "Alice" }); // → "Hello Alice!"
tpl.execute({ name: "Bob" });   // → "Hello Bob!"

// Analyze without re-parsing
tpl.analyze(schema);

// Validate
tpl.validate(schema);

// Both at once
const { analysis, value } = tpl.analyzeAndExecute(schema, data);
```

Object templates and literal values can also be compiled:

```ts
const tpl = engine.compile({
  userName: "{{name}}",
  userAge:  "{{age}}",
  fixed:    42,
});

tpl.execute(data);
// → { userName: "Alice", userAge: 30, fixed: 42 }

tpl.analyze(schema).outputSchema;
// → { type: "object", properties: { userName: { type: "string" }, userAge: { type: "number" }, fixed: { type: "integer" } }, ... }
```

---

## Object Templates

Pass an object where each property is a template. Every property is analyzed/executed independently:

```ts
const engine = new Typebars();

// Execute
const result = engine.execute(
  {
    greeting: "Hello {{name}}!",
    userAge:  "{{age}}",
    tags:     "{{tags}}",
    fixed:    42,
    nested: {
      city: "{{address.city}}",
    },
  },
  data,
);
// → {
//   greeting: "Hello Alice!",
//   userAge: 30,
//   tags: ["ts", "js"],
//   fixed: 42,
//   nested: { city: "Paris" },
// }

// Validate — errors from ALL properties are collected
const analysis = engine.analyze(
  {
    ok:  "{{name}}",
    bad: "{{nonexistent}}",
  },
  schema,
);
// analysis.valid → false (at least one property has an error)
// analysis.diagnostics → [{ ... "nonexistent" ... }]
```

---

## Block Helpers

### `{{#if}}` / `{{#unless}}`

Conditional rendering. The analyzer validates the condition and both branches.

The condition can be a simple property reference **or a sub-expression** using one of the [built-in logical helpers](#built-in-logical--comparison-helpers):

```ts
// Simple property condition
engine.execute("{{#if active}}Online{{else}}Offline{{/if}}", data);
// → "Online"

engine.execute("{{#unless active}}No{{else}}Yes{{/unless}}", { active: false });
// → "No"

// Sub-expression condition (see "Built-in Logical & Comparison Helpers")
engine.execute(
  "{{#if (gt age 18)}}Adult{{else}}Minor{{/if}}",
  { age: 30 },
);
// → "Adult"

engine.execute(
  '{{#if (eq role "admin")}}Full access{{else}}Limited{{/if}}',
  { role: "admin" },
);
// → "Full access"
```

> **Note:** Handlebars natively only supports simple property references as `{{#if}}` conditions (e.g. `{{#if active}}`). Sub-expression conditions like `{{#if (gt age 18)}}` are made possible by the logical helpers that Typebars pre-registers on every engine instance. See [Built-in Logical & Comparison Helpers](#built-in-logical--comparison-helpers) for details.

### `{{#each}}`

Iterates over arrays. The analyzer validates that the target is an array and switches the schema context to the item schema:

```ts
engine.execute("{{#each tags}}{{this}} {{/each}}", data);
// → "ts js "

engine.execute("{{#each orders}}#{{id}} {{product}} {{/each}}", {
  orders: [
    { id: 1, product: "Keyboard" },
    { id: 2, product: "Mouse" },
  ],
});
// → "#1 Keyboard #2 Mouse "

// Nested #each
engine.execute(
  "{{#each groups}}[{{#each members}}{{this}}{{/each}}]{{/each}}",
  { groups: [{ members: ["a", "b"] }, { members: ["c"] }] },
);
// → "[ab][c]"
```

### `{{#with}}`

Changes the context to a sub-object. The analyzer switches the schema context:

```ts
engine.execute("{{#with address}}{{city}}, {{zip}}{{/with}}", {
  address: { city: "Paris", zip: "75001" },
});
// → "Paris, 75001"

// Nested #with
engine.analyze(
  "{{#with level1}}{{#with level2}}{{value}}{{/with}}{{/with}}",
  {
    type: "object",
    properties: {
      level1: {
        type: "object",
        properties: {
          level2: {
            type: "object",
            properties: { value: { type: "string" } },
          },
        },
      },
    },
  },
);
// → valid: true
```

---

## Built-in Math Helpers

Pre-registered on every `Typebars` instance. All return `{ type: "number" }` for static analysis.

### Named Operators

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
engine.execute("{{div items.length count}}", { items: [1,2,3,4,5], count: 2 }); // → 2.5
```

### Generic `math` Helper

Inline arithmetic with the operator as a string:

```ts
engine.execute('{{math a "+" b}}', { a: 10, b: 3 });   // → 13
engine.execute('{{math a "*" b}}', { a: 10, b: 3 });   // → 30
engine.execute('{{math a "**" b}}', { a: 2, b: 10 });  // → 1024
```

Supported operators: `+`, `-`, `*`, `/`, `%`, `**`

All math helpers are **fully integrated with static analysis** — they validate that parameters resolve to `{ type: "number" }` and infer `{ type: "number" }` as output:

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

## Built-in Logical & Comparison Helpers

Pre-registered on every `Typebars` instance. All return `{ type: "boolean" }` for static analysis.

These helpers enable **conditional logic** inside templates via Handlebars [sub-expressions](https://handlebarsjs.com/guide/subexpressions.html) — the `(helper arg1 arg2)` syntax used as arguments to block helpers like `{{#if}}` and `{{#unless}}`.

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

These helpers are **fully integrated with the static analyzer**: argument types are validated, missing properties are caught, and the output schema is correctly inferred from the branches — not from the boolean condition.

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

`defineHelper()` infers the TypeScript types of your `fn` arguments from the JSON Schemas declared in `params`:

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

---

## Template Identifiers (`{{key:N}}`)

The `{{key:N}}` syntax references variables from **different data sources**, identified by a numeric ID. Useful in workflow engines or multi-step pipelines.

### Analysis with Identifier Schemas

Each identifier maps to its own JSON Schema:

```ts
const engine = new Typebars();

const inputSchema = { type: "object", properties: {} };

const identifierSchemas = {
  1: {
    type: "object",
    properties: { meetingId: { type: "string" } },
  },
  2: {
    type: "object",
    properties: { leadName: { type: "string" } },
  },
};

// ✅ Valid — meetingId exists in identifier 1's schema
engine.analyze("{{meetingId:1}}", inputSchema, identifierSchemas);
// → valid: true, outputSchema: { type: "string" }

// ❌ Invalid — identifier 1 doesn't have "badKey"
engine.analyze("{{badKey:1}}", inputSchema, identifierSchemas);
// → valid: false, code: IDENTIFIER_PROPERTY_NOT_FOUND

// ❌ Invalid — identifier 99 doesn't exist
engine.analyze("{{meetingId:99}}", inputSchema, identifierSchemas);
// → valid: false, code: UNKNOWN_IDENTIFIER

// ❌ Invalid — identifiers used but no schemas provided
engine.analyze("{{meetingId:1}}", inputSchema);
// → valid: false, code: MISSING_IDENTIFIER_SCHEMAS
```

### Mixing Identifier and Regular Expressions

Regular expressions validate against `inputSchema`, identifier expressions against `identifierSchemas`:

```ts
const schema = {
  type: "object",
  properties: { name: { type: "string" } },
};

const idSchemas = {
  1: {
    type: "object",
    properties: { meetingId: { type: "string" } },
  },
};

// ✅ "name" validated against schema, "meetingId:1" against idSchemas[1]
engine.analyze("{{name}} — {{meetingId:1}}", schema, idSchemas);
// → valid: true
```

### Execution with Identifier Data

```ts
const result = engine.execute(
  "Meeting: {{meetingId:1}}, Lead: {{leadName:2}}",
  {},
  {
    identifierData: {
      1: { meetingId: "MTG-42" },
      2: { leadName: "Alice" },
    },
  },
);
// → "Meeting: MTG-42, Lead: Alice"

// Single expression preserves type
engine.execute("{{count:1}}", {}, {
  identifierData: { 1: { count: 42 } },
});
// → 42 (number)
```

### `analyzeAndExecute` with Identifiers

```ts
const { analysis, value } = engine.analyzeAndExecute(
  "{{total:1}}",
  {},
  {},
  {
    identifierSchemas: {
      1: { type: "object", properties: { total: { type: "number" } } },
    },
    identifierData: {
      1: { total: 99.95 },
    },
  },
);

analysis.valid;        // true
analysis.outputSchema; // { type: "number" }
value;                 // 99.95
```

---

## Error Handling

### `TemplateParseError`

Thrown when the template has invalid Handlebars syntax:

```ts
try {
  engine.execute("{{#if}}unclosed", {});
} catch (err) {
  // err instanceof TemplateParseError
  // err.message → "Parse error: ..."
  // err.loc     → { line, column } if available
}
```

### `TemplateAnalysisError`

Thrown when `execute()` is called with a `schema` option and the template fails validation:

```ts
try {
  engine.execute("{{unknown}}", data, {
    schema: { type: "object", properties: { name: { type: "string" } } },
  });
} catch (err) {
  // err instanceof TemplateAnalysisError
  err.diagnostics;  // TemplateDiagnostic[]
  err.errors;       // only severity: "error"
  err.warnings;     // only severity: "warning"
  err.errorCount;   // number
  err.warningCount; // number
  err.toJSON();     // serializable for API responses
}
```

The `toJSON()` method produces a clean structure for HTTP APIs:

```ts
// Express / Hono / etc.
res.status(400).json(err.toJSON());
// → {
//   name: "TemplateAnalysisError",
//   message: "Static analysis failed with 1 error(s): ...",
//   errorCount: 1,
//   warningCount: 0,
//   diagnostics: [{ severity, code, message, loc, source, details }],
// }
```

### Syntax Validation (No Schema)

For live editors, check syntax without a schema:

```ts
engine.isValidSyntax("Hello {{name}}");           // true
engine.isValidSyntax("{{#if x}}yes{{/if}}");      // true
engine.isValidSyntax("{{#if x}}oops{{/unless}}"); // false
```

---

## Configuration & API Reference

### Constructor

```ts
const engine = new Typebars({
  astCacheSize: 256,         // LRU cache for parsed ASTs (default: 256)
  compilationCacheSize: 256, // LRU cache for Handlebars compilations (default: 256)
  helpers: [],               // Custom helpers to register at construction
});
```

### `TemplateInput`

All methods accept a `TemplateInput`:

```ts
type TemplateInput =
  | string              // Handlebars template
  | number              // Literal passthrough
  | boolean             // Literal passthrough
  | null                // Literal passthrough
  | TemplateInputObject // Object where each property is a TemplateInput
```

### Methods

| Method | Description |
|--------|-------------|
| `analyze(template, inputSchema, identifierSchemas?)` | Validates template + infers output schema. Returns `AnalysisResult` |
| `validate(template, inputSchema, identifierSchemas?)` | Like `analyze()` but without `outputSchema`. Returns `ValidationResult` |
| `execute(template, data, options?)` | Renders the template. Options: `{ schema?, identifierData?, identifierSchemas? }` |
| `analyzeAndExecute(template, inputSchema, data, options?)` | Analyze + execute in one call. Returns `{ analysis, value }` |
| `compile(template)` | Returns a `CompiledTemplate` (parse-once, execute-many) |
| `isValidSyntax(template)` | Syntax check only (no schema needed). Returns `boolean` |
| `registerHelper(name, definition)` | Register a custom helper. Returns `this` |
| `unregisterHelper(name)` | Remove a helper. Returns `this` |
| `hasHelper(name)` | Check if a helper is registered |
| `clearCaches()` | Clear all internal caches |

### `AnalysisResult`

```ts
interface AnalysisResult {
  valid: boolean;                    // true if no errors
  diagnostics: TemplateDiagnostic[]; // errors + warnings
  outputSchema: JSONSchema7;         // inferred output type
}
```

### `CompiledTemplate`

Returned by `engine.compile()`. Has the same methods but without re-parsing:

| Method | Description |
|--------|-------------|
| `execute(data, options?)` | Render with data |
| `analyze(inputSchema, identifierSchemas?)` | Validate + infer output schema |
| `validate(inputSchema, identifierSchemas?)` | Validate only |
| `analyzeAndExecute(inputSchema, data, options?)` | Both at once |

---

## License

MIT