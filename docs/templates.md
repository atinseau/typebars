# Templates

> **[← Back to README](../README.md)** | **Related:** [Static Analysis](static-analysis.md) · [Execution](execution.md) · [Helpers](helpers.md) · [API Reference](api-reference.md)

Typebars accepts more than just strings. The `TemplateInput` type is a recursive union that supports objects, arrays, and literal values alongside standard Handlebars template strings.

---

## Table of Contents

- [Object Templates](#object-templates)
  - [Basic Usage](#basic-usage)
  - [Nested Objects](#nested-objects)
  - [Mixed Values](#mixed-values)
  - [Validation](#validation)
- [Array Templates](#array-templates)
  - [Basic Usage](#array-basic-usage)
  - [Mixed Element Types](#mixed-element-types)
- [Block Helpers](#block-helpers)
  - [`{{#if}}` / `{{#unless}}`](#if--unless)
  - [`{{#each}}`](#each)
  - [`{{#with}}`](#with)
  - [Nested Blocks](#nested-blocks)

---

## Object Templates

Pass an object where each property is a `TemplateInput`. Every property is analyzed and executed independently. The output is an object with the same keys but resolved values.

### Basic Usage

```ts
const engine = new Typebars();

const data = {
  name: "Alice",
  age: 30,
  active: true,
  tags: ["ts", "js"],
  address: { city: "Paris" },
};

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
//   greeting: "Hello Alice!",   ← string (mixed template)
//   userAge: 30,                ← number (single expression — type preserved)
//   tags: ["ts", "js"],         ← array (single expression — type preserved)
//   fixed: 42,                  ← number (literal passthrough)
//   nested: { city: "Paris" },  ← nested object
// }
```

### Nested Objects

Nesting works recursively — each level is processed independently:

```ts
engine.execute(
  {
    user: {
      name: "{{name}}",
      age:  "{{age}}",
    },
    meta: {
      active: "{{active}}",
    },
  },
  data,
);
// → {
//   user: { name: "Alice", age: 30 },
//   meta: { active: true },
// }
```

### Mixed Values

Object properties can be any `TemplateInput` — strings, numbers, booleans, `null`, nested objects, or arrays:

```ts
engine.execute(
  {
    name:     "{{name}}",          // Handlebars template
    version:  42,                  // literal number
    isPublic: true,                // literal boolean
    deleted:  null,                // literal null
    tags:     ["{{name}}", 42],    // array template (see below)
    nested:   { city: "{{address.city}}" },
  },
  data,
);
```

### Validation

When analyzing an object template, all properties are validated. If **any** property is invalid, the entire object is marked as `valid: false` and all diagnostics are collected:

```ts
const analysis = engine.analyze(
  {
    ok:  "{{name}}",
    bad: "{{nonexistent}}",
  },
  schema,
);
// analysis.valid → false
// analysis.diagnostics → [{ code: "UNKNOWN_PROPERTY", ... "nonexistent" ... }]
```

The inferred [output schema](static-analysis.md#object-templates--object-schema) is an object schema with each property's resolved type:

```ts
analysis.outputSchema;
// → {
//   type: "object",
//   properties: {
//     ok:  { type: "string" },
//     bad: { type: "string" },   ← still inferred even if invalid
//   },
//   required: ["ok", "bad"],
// }
```

---

## Array Templates

Pass an array where each element is a `TemplateInput`. Every element is analyzed and executed independently. The output is an array with the same length but resolved values.

### Basic Usage {#array-basic-usage}

```ts
const engine = new Typebars();

const result = engine.execute(
  ["{{name}}", "{{age}}", 42, true],
  { name: "Alice", age: 30 },
);
// → ["Alice", 30, 42, true]
```

Each element follows the same type preservation rules as any other template input:
- `"{{name}}"` → `"Alice"` (single expression → raw string value)
- `"{{age}}"` → `30` (single expression → raw number value)
- `42` → `42` (literal passthrough)
- `true` → `true` (literal passthrough)

### Mixed Element Types

Array elements can be any `TemplateInput`, including nested objects and arrays:

```ts
engine.execute(
  [
    "Hello {{name}}!",
    "{{age}}",
    { city: "{{address.city}}" },
    [1, "{{active}}"],
  ],
  data,
);
// → [
//   "Hello Alice!",
//   30,
//   { city: "Paris" },
//   [1, true],
// ]
```

Analysis infers an array output schema with `items` describing the element types:

```ts
engine.analyze(
  ["{{name}}", "{{age}}", 42],
  schema,
).outputSchema;
// → { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }, { type: "integer" }] } }
```

Array templates also support all [advanced options](advanced.md) like `coerceSchema` (with `items` propagation) and `excludeTemplateExpression`.

---

## Block Helpers

Block helpers control flow within templates. The [static analyzer](static-analysis.md#validation-inside-block-helpers) validates every expression inside every branch, and the [output schema inference](static-analysis.md#single-block--branch-type-inference) accounts for branch types.

### `{{#if}}` / `{{#unless}}`

Conditional rendering. The analyzer validates the condition and both branches.

The condition can be a simple property reference **or a sub-expression** using one of the [built-in logical helpers](helpers.md#logical--comparison-helpers):

```ts
// Simple property condition
engine.execute("{{#if active}}Online{{else}}Offline{{/if}}", data);
// → "Online"

engine.execute("{{#unless active}}No{{else}}Yes{{/unless}}", { active: false });
// → "No"

// Sub-expression condition (see "Built-in Helpers")
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

> **Note:** Handlebars natively only supports simple property references as `{{#if}}` conditions (e.g. `{{#if active}}`). Sub-expression conditions like `{{#if (gt age 18)}}` are made possible by the logical helpers that Typebars pre-registers on every engine instance. See [Built-in Logical & Comparison Helpers](helpers.md#logical--comparison-helpers) for details.

**Output schema inference:**

When the template is a single block, Typebars infers the output type from the branches:

```ts
// Both branches are numbers → output is number
engine.analyze("{{#if active}}10{{else}}20{{/if}}", schema).outputSchema;
// → { type: "number" }

// Different types → oneOf union
engine.analyze("{{#if active}}42{{else}}hello{{/if}}", schema).outputSchema;
// → { oneOf: [{ type: "number" }, { type: "string" }] }
```

See [Branch Type Inference](static-analysis.md#single-block--branch-type-inference) for the full inference rules.

### `{{#each}}`

Iterates over arrays. The analyzer validates that the target is an array and switches the schema context to the array's `items` schema:

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
```

**Context switching:** Inside `{{#each orders}}`, the context becomes the item schema. `{{id}}` and `{{product}}` are resolved from the item, not the root.

Inside `{{#each tags}}` (where tags is `string[]`), the context becomes `{ type: "string" }` and `{{this}}` refers to each string element.

**Nested `{{#each}}`:**

```ts
engine.execute(
  "{{#each groups}}[{{#each members}}{{this}}{{/each}}]{{/each}}",
  { groups: [{ members: ["a", "b"] }, { members: ["c"] }] },
);
// → "[ab][c]"
```

**Static analysis:**

```ts
// ✅ Valid — "product" and "id" exist in the item schema
engine.analyze("{{#each orders}}{{product}} #{{id}}{{/each}}", schema);

// ❌ Property doesn't exist in the item schema
engine.analyze("{{#each orders}}{{badField}}{{/each}}", schema);
// → UNKNOWN_PROPERTY

// ❌ Target is not an array
engine.analyze("{{#each name}}{{this}}{{/each}}", schema);
// → TYPE_MISMATCH: "{{#each}}" expects array, got "string"
```

> **Output type:** `{{#each}}` always produces `{ type: "string" }` as its output schema, because the iteration results are concatenated into a single string by Handlebars.

### `{{#with}}`

Changes the context to a sub-object. The analyzer switches the schema context accordingly:

```ts
engine.execute("{{#with address}}{{city}}, {{zip}}{{/with}}", {
  address: { city: "Paris", zip: "75001" },
});
// → "Paris, 75001"
```

**Nested `{{#with}}`:**

```ts
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

**Static analysis:**

```ts
// ✅ Valid — "city" exists inside "address"
engine.analyze("{{#with address}}{{city}}{{/with}}", schema);

// ❌ "country" doesn't exist in the sub-context
engine.analyze("{{#with address}}{{country}}{{/with}}", schema);
// → UNKNOWN_PROPERTY
```

> **Output type:** `{{#with}}` as a single block infers the type of its inner body. For example, `{{#with address}}{{city}}{{/with}}` infers `{ type: "string" }`.

### Nested Blocks

Blocks can be combined and nested. The analyzer validates at every level:

```ts
engine.analyze(
  "{{#with address}}{{city}}{{/with}} — {{#each tags}}{{this}}{{/each}}",
  schema,
);
// → valid: true (both blocks are validated independently)

engine.analyze(
  "{{#if active}}{{#each orders}}{{product}}{{/each}}{{else}}none{{/if}}",
  schema,
);
// → valid: true (nested #each inside #if is validated with the correct context)
```

---

## What's Next?

- **[Built-in & Custom Helpers](helpers.md)** — math, logical, comparison, `map`, and custom helpers for use inside templates
- **[Static Analysis](static-analysis.md)** — how templates are validated and output types are inferred
- **[Execution](execution.md)** — type preservation, execution modes, and compiled templates
- **[Advanced Features](advanced.md)** — `coerceSchema`, `excludeTemplateExpression`, `$root` token