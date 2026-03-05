import { Typebars } from "./src";

const tp = new Typebars();

const result = tp.execute({ name: "{{name}}", value: 42 }, undefined, {
	excludeTemplateExpression: true,
});

console.log(result);
