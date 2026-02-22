import type { JSONSchema7 } from "../src/types.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────
// Schema et données réutilisés dans la majorité des tests.

export const userSchema: JSONSchema7 = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "number" },
    active: { type: "boolean" },
    score: { type: "integer" },
    address: {
      type: "object",
      properties: {
        city: { type: "string" },
        zip: { type: "string" },
      },
    },
    tags: {
      type: "array",
      items: { type: "string" },
    },
    orders: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          product: { type: "string" },
          quantity: { type: "integer" },
        },
      },
    },
    metadata: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["admin", "user", "guest"] },
        permissions: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  },
  required: ["name", "age"],
};

export const userData = {
  name: "Alice",
  age: 30,
  active: true,
  score: 95,
  address: { city: "Paris", zip: "75001" },
  tags: ["developer", "typescript", "open-source"],
  orders: [
    { id: 1, product: "Keyboard", quantity: 1 },
    { id: 2, product: "Monitor", quantity: 2 },
    { id: 3, product: "Mouse", quantity: 3 },
  ],
  metadata: {
    role: "admin",
    permissions: ["read", "write", "delete"],
  },
};
