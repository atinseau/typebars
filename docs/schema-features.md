# Schema Features

> **[← Back to README](../README.md)** | **Related:** [Static Analysis](static-analysis.md) · [API Reference](api-reference.md)

Typebars works exclusively with **JSON Schema Draft 7** (`JSONSchema7`). This page covers the schema features supported by the static analyzer and schema resolver.

---

## Table of Contents

- [`$ref` Resolution](#ref-resolution)
- [Combinators (`allOf`, `anyOf`, `oneOf`)](#combinators-allof-anyof-oneof)
- [`additionalProperties`](#additionalproperties)
- [Array `.length` Intrinsic](#array-length-intrinsic)
- [Conditional Schemas (`if`/`then`/`else`)](#conditional-schemas-ifthenelse)

---

## `$ref` Resolution

Internal `$ref` references (`#/definitions/...` or `#/$defs/...`) are resolved transparently:

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

> **Note:** Only internal references are supported. External references (e.g. `{ "$ref": "https://..." }`) are not resolved.

---

## Combinators (`allOf`, `anyOf`, `oneOf`)

Properties defined across combinators are resolved by searching all branches:

### `allOf`

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

### `anyOf` / `oneOf`

```ts
const schema = {
  type: "object",
  oneOf: [
    { type: "object", properties: { x: { type: "string" } } },
    { type: "object", properties: { y: { type: "number" } } },
  ],
};

// Properties from any branch are searchable
engine.analyze("{{x}}", schema).valid; // true
engine.analyze("{{y}}", schema).valid; // true
```

`anyOf` works the same way — all branches are searched for property resolution.

### Combinators with `$ref`

Combinators and `$ref` can be combined. The resolver handles both transparently:

```ts
const schema = {
  type: "object",
  definitions: {
    Base: {
      type: "object",
      properties: { id: { type: "number" } },
    },
  },
  allOf: [
    { $ref: "#/definitions/Base" },
    { type: "object", properties: { name: { type: "string" } } },
  ],
};

engine.analyze("{{id}}", schema).valid;   // true
engine.analyze("{{name}}", schema).valid; // true
```

---

## `additionalProperties`

When a property isn't found in `properties`, the resolver checks `additionalProperties`:

### `additionalProperties: true`

Any property is allowed, but the type is unknown:

```ts
engine.analyze("{{anything}}", { type: "object", additionalProperties: true });
// → valid: true, outputSchema: {}
```

### `additionalProperties` with a schema

Unknown properties resolve to the specified schema:

```ts
engine.analyze("{{anything}}", {
  type: "object",
  additionalProperties: { type: "number" },
});
// → valid: true, outputSchema: { type: "number" }
```

### `additionalProperties: false`

Unknown properties are rejected:

```ts
engine.analyze("{{anything}}", {
  type: "object",
  properties: { name: { type: "string" } },
  additionalProperties: false,
});
// → valid: false, code: UNKNOWN_PROPERTY
```

### Mixed: known + additional properties

Known properties resolve to their declared type; unknown properties fall back to `additionalProperties`:

```ts
const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
  },
  additionalProperties: { type: "number" },
};

engine.analyze("{{name}}", schema).outputSchema;
// → { type: "string" } — from properties

engine.analyze("{{score}}", schema).outputSchema;
// → { type: "number" } — from additionalProperties
```

---

## Array `.length` Intrinsic

Accessing `.length` on an array property is valid and inferred as `{ type: "integer" }`:

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
```

This also works at execution time — the actual `.length` value is returned as a number:

```ts
engine.execute("{{tags.length}}", { tags: ["a", "b", "c"] });
// → 3

// Useful with math helpers
engine.execute("{{div items.length count}}", { items: [1, 2, 3, 4, 5], count: 2 });
// → 2.5
```

> **Note:** `.length` on a non-array type is invalid and produces an `UNKNOWN_PROPERTY` diagnostic:
>
> ```ts
> engine.analyze("{{name.length}}", {
>   type: "object",
>   properties: { name: { type: "string" } },
> });
> // → valid: false, code: UNKNOWN_PROPERTY
> ```

---

## Conditional Schemas (`if`/`then`/`else`)

JSON Schema `if`/`then`/`else` conditional schemas are **intentionally not supported**. This is a design decision — Typebars explicitly rejects schemas containing these keywords and reports an error.

Use `oneOf`, `anyOf`, or `allOf` instead to express variant types. These combinators are fully supported by the resolver and the static analyzer.

---

## What's Next?

- **[Static Analysis](static-analysis.md)** — how validation and output inference use these schema features
- **[Templates](templates.md)** — object templates, block helpers, and how context switching works with schemas
- **[Advanced Features](advanced.md)** — `coerceSchema` for output type control
- **[API Reference](api-reference.md)** — full API documentation