import { TemplateEngine } from "./src/index.ts";

const engine = new TemplateEngine();

console.log(
	engine.analyzeAndExecute(
		{
			userName: "{{name}}",
			userAge: "{{age}}",
			isAdult: "{{age >= 18}}",
			userStatus: "success",
		},
		{
			name: { type: "string" },
			age: { type: "number" },
		},
		{
			name: "Arthur",
			age: 30,
		},
	),
);
