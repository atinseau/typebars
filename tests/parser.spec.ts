import { describe, test, expect } from "bun:test";
import { parse, TemplateParseError } from "../src/index.ts";

describe("parser", () => {
  test("parse retourne un AST valide pour un template simple", () => {
    const ast = parse("Hello {{name}}");
    expect(ast).toBeDefined();
    expect(ast.type).toBe("Program");
    expect(ast.body.length).toBe(2); // ContentStatement + MustacheStatement
  });

  test("parse retourne un AST pour une expression unique", () => {
    const ast = parse("{{name}}");
    expect(ast.body.length).toBe(1);
    expect(ast.body[0]!.type).toBe("MustacheStatement");
  });

  test("parse gère les blocs if", () => {
    const ast = parse("{{#if active}}yes{{/if}}");
    expect(ast.body.length).toBe(1);
    expect(ast.body[0]!.type).toBe("BlockStatement");
  });

  test("parse gère les blocs each", () => {
    const ast = parse("{{#each items}}{{this}}{{/each}}");
    expect(ast.body[0]!.type).toBe("BlockStatement");
  });

  test("parse lève TemplateParseError pour un template invalide", () => {
    expect(() => parse("{{#if x}}oops{{/each}}")).toThrow(TemplateParseError);
  });

  test("parse lève TemplateParseError pour un bloc non fermé", () => {
    expect(() => parse("{{#if x}}")).toThrow(TemplateParseError);
  });

  test("parse accepte les commentaires", () => {
    const ast = parse("{{!-- commentaire --}}Hello");
    // Le commentaire + le texte
    expect(ast.body.length).toBeGreaterThanOrEqual(1);
  });

  test("parse gère le texte pur sans expressions", () => {
    const ast = parse("Just plain text");
    expect(ast.body.length).toBe(1);
    expect(ast.body[0]!.type).toBe("ContentStatement");
  });
});
