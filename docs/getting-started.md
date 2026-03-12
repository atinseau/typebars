# Getting Started

> **[← Back to README](../README.md)**

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

### The Three Core Operations

| Operation | Description | Returns |
|-----------|-------------|---------|
| `analyze()` | Validates the template and infers the output type | `AnalysisResult` with `valid`, `diagnostics`, `outputSchema` |
| `execute()` | Renders the template with data | The result value (type-preserved) |
| `analyzeAndExecute()` | Both in one call | `{ analysis, value }` |

### Template Input Types

Typebars doesn't just accept strings. The engine accepts a `TemplateInput` union type:

| Input type | Behavior |
|------------|----------|
| `string` | Standard Handlebars template — parsed and executed |
| `number` | Literal passthrough (e.g. `42` → `42`) |
| `boolean` | Literal passthrough (e.g. `true` → `true`) |
| `null` | Literal passthrough (`null` → `null`) |
| `TemplateInputObject` | Object where each property is a `TemplateInput` — see [Templates](templates.md) |
| `TemplateInputArray` | Array where each element is a `TemplateInput` — see [Templates](templates.md) |

---

## What's Next?

- **[Static Analysis](static-analysis.md)** — learn how input validation and output schema inference work
- **[Templates](templates.md)** — object templates, array templates, and block helpers
- **[Built-in & Custom Helpers](helpers.md)** — math, logical, comparison, map, and custom helpers
- **[API Reference](api-reference.md)** — full API documentation