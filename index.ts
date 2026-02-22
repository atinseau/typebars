import { TemplateEngine } from "./src/index.ts";

const engine = new TemplateEngine({
	strictMode: true,
});

const template = `
  {{user}}
  {{hello}}
`;

const result = engine.analyze(template, {
	type: "object",
	properties: {
		showAge: { type: "boolean" },
		user: {
			type: "object",
			properties: {
				name: { type: "string" },
				age: { type: "number" },
			},
		},
	},
});

console.log(JSON.stringify(result, null, 2));
