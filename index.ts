import type { JSONSchema7 } from "json-schema";
import { TemplateEngine } from "./src/index.ts";

// ─── Showcase des nouvelles fonctionnalités du Template Engine v2 ─────────────

const engine = new TemplateEngine();

const template = `
  <div>
    <h1>{{ title }}</h1>
    <p>{{ description }}</p>
    <ul>
      {{#each items}}
        <li>{{ this }}</li>
      {{/each}}
    </ul>
  </div>
`;

const schema: JSONSchema7 = {
	type: "object",
	properties: {
		title: { type: "string" },
		description: { type: "string" },
		items: {
			type: "array",
			items: { type: "string" },
		},
	},
	required: ["title", "description", "items"],
} as const;

console.log(engine.analyze(template, schema));
