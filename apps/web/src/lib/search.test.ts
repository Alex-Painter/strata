import { expect, it } from "vitest";
import { matchesSearch, type Searchable } from "./search";

const row: Searchable = {
  title: "Add the billing table",
  repo: "acme/app",
  note: "#124 assigned to you",
  numbers: [123, 124],
  text: ["Billing API", "sam", "feat/billing-api", "main"],
};

it("matches everything when the query is empty", () => {
  expect(matchesSearch(row, "")).toBe(true);
  expect(matchesSearch(row, "   ")).toBe(true);
});

it("matches a PR number with or without #, from its first digits", () => {
  expect(matchesSearch(row, "123")).toBe(true);
  expect(matchesSearch(row, "#124")).toBe(true);
  expect(matchesSearch(row, "12")).toBe(true);
  expect(matchesSearch(row, "23")).toBe(false);
  expect(matchesSearch(row, "#999")).toBe(false);
});

it("matches free text in titles, authors, branches and the repo, without regard to case", () => {
  expect(matchesSearch(row, "BILLING")).toBe(true);
  expect(matchesSearch(row, "sam")).toBe(true);
  expect(matchesSearch(row, "feat/billing")).toBe(true);
  expect(matchesSearch(row, "acme/app#123")).toBe(true);
  expect(matchesSearch(row, "acme/app#9")).toBe(false);
  expect(matchesSearch(row, "invoices")).toBe(false);
});

it("needs every word to match", () => {
  expect(matchesSearch(row, "billing 123")).toBe(true);
  expect(matchesSearch(row, "billing 999")).toBe(false);
});
