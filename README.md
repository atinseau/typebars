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

// Static analysis — no data needed
const { valid, diagnostics, outputSchema } = engine.analyze(
  "Hello {{name}}, you are {{age}}!",
  inputSchema,
);

valid;        // true — every referenced variable exists
outputSchema; // { type: "string" } — mixed template always produces a string

// Execution — types are preserved
engine.execute("{{age}}", { name: "Alice", age: 30 }); // → 30 (number, not string)
```

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

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, quick start, and how the engine works |
| [Static Analysis](docs/static-analysis.md) | Input validation, output schema inference, and diagnostics |
| [Schema Features](docs/schema-features.md) | `$ref` resolution, combinators, `additionalProperties`, array `.length` |
| [Execution & Compiled Templates](docs/execution.md) | Type preservation, execution modes, and compile-once / execute-many |
| [Templates](docs/templates.md) | Object templates, array templates, and block helpers (`#if`, `#each`, `#with`) |
| [Built-in & Custom Helpers](docs/helpers.md) | Math, logical, comparison, `map` helper, and custom helper registration |
| [Template Identifiers](docs/identifiers.md) | The `{{key:N}}` syntax for multi-source data pipelines |
| [Advanced Features](docs/advanced.md) | `coerceSchema`, `excludeTemplateExpression`, and the `$root` token |
| [Error Handling](docs/error-handling.md) | Error hierarchy, diagnostics structure, and syntax validation |
| [API Reference](docs/api-reference.md) | Full API: constructor, methods, types, and options |

---

## Key Features

- **Static analysis** — validate templates against JSON Schema before execution ([docs](docs/static-analysis.md))
- **Output schema inference** — know the exact type of the result without running anything ([docs](docs/static-analysis.md#output-schema-inference))
- **Type preservation** — `{{age}}` returns `30` (number), not `"30"` ([docs](docs/execution.md))
- **Object & array templates** — pass structured inputs, get structured outputs ([docs](docs/templates.md))
- **Block helpers** — `#if`, `#unless`, `#each`, `#with` with full static analysis ([docs](docs/templates.md#block-helpers))
- **Built-in helpers** — math, logical, comparison, and `map` — all statically analyzed ([docs](docs/helpers.md))
- **Custom helpers** — register your own with type metadata for full analysis integration ([docs](docs/helpers.md#custom-helpers))
- **Template identifiers** — `{{key:N}}` syntax for multi-source workflows ([docs](docs/identifiers.md))
- **Output type coercion** — control how static literals are typed with `coerceSchema` ([docs](docs/advanced.md#output-type-coercion-coerceschema))
- **Expression filtering** — exclude dynamic expressions from output with `excludeTemplateExpression` ([docs](docs/advanced.md#exclude-template-expressions))
- **`$root` token** — reference the entire root context for primitive schemas ([docs](docs/advanced.md#root-token))
- **Compiled templates** — parse once, execute many times ([docs](docs/execution.md#compiled-templates))
- **JSON Schema v7** — `$ref`, `allOf`/`anyOf`/`oneOf`, `additionalProperties` ([docs](docs/schema-features.md))

---

## License

MIT
