import { describe, it, expect } from "vitest";
import { evalExpression, evaluateSuggestions } from "./expression-evaluator";
import type { CustomerMinData } from "./types";

const customer: CustomerMinData = {
  customerId: "C0001",
  name: "Acme JP",
  country: "JP",
  industry: "Auto",
  customerType: "standard_b2b",
  legalEntity: "Acme Japan KK",
  defaultCurrency: "JPY",
};

const lookups = {
  currency_by_country: { JP: "JPY", US: "USD", DE: "EUR" },
};

describe("expression-evaluator", () => {
  describe("evalExpression", () => {
    it("returns literal strings unchanged", () => {
      expect(evalExpression("NET30", customer, lookups)).toBe("NET30");
    });

    it("returns non-string values unchanged", () => {
      expect(evalExpression(42, customer, lookups)).toBe(42);
      expect(evalExpression(null, customer, lookups)).toBe(null);
      expect(evalExpression(true, customer, lookups)).toBe(true);
    });

    it("resolves customer.<field>", () => {
      expect(evalExpression("${customer.country}", customer, lookups)).toBe("JP");
      expect(evalExpression("${customer.industry}", customer, lookups)).toBe("Auto");
    });

    it("preserves non-string types when whole-string is an expression", () => {
      const customer2 = { ...customer, country: null };
      expect(evalExpression("${customer.country}", customer2, lookups)).toBe(null);
    });

    it("looks up via lookup.X[customer.Y]", () => {
      expect(
        evalExpression("${lookup.currency_by_country[customer.country]}", customer, lookups)
      ).toBe("JPY");
    });

    it("returns undefined for missing lookup key", () => {
      const cust = { ...customer, country: "XX" };
      expect(
        evalExpression("${lookup.currency_by_country[customer.country]}", cust, lookups)
      ).toBe(undefined);
    });

    it("supports string-equality ternary", () => {
      expect(
        evalExpression("${customer.industry == 'Auto' ? 180 : 90}", customer, lookups)
      ).toBe(180);
      const other = { ...customer, industry: "Retail" };
      expect(
        evalExpression("${customer.industry == 'Auto' ? 180 : 90}", other, lookups)
      ).toBe(90);
    });

    it("supports string-inequality ternary", () => {
      expect(
        evalExpression("${customer.country != 'US' ? 'foreign' : 'domestic'}", customer, lookups)
      ).toBe("foreign");
    });

    it("interpolates inline ${...} inside larger string", () => {
      expect(
        evalExpression("${customer.customerType}_${customer.country}", customer, lookups)
      ).toBe("standard_b2b_JP");
    });

    it("treats unknown identifiers as raw ref strings (defensive)", () => {
      // Not erroring out — POC choice; could change later
      const v = evalExpression("${customer.nonexistent}", customer, lookups);
      expect(v).toBe(undefined);
    });
  });

  describe("evaluateSuggestions", () => {
    it("evaluates each rule independently", () => {
      const out = evaluateSuggestions(
        {
          currency: "${lookup.currency_by_country[customer.country]}",
          tax_region: "${customer.country}",
          payment_terms: "NET30",
          credit: "${customer.industry == 'Auto' ? 100000 : 50000}",
        },
        customer,
        lookups
      );
      expect(out).toEqual({
        currency: "JPY",
        tax_region: "JP",
        payment_terms: "NET30",
        credit: 100000,
      });
    });

    it("returns empty object for undefined rules", () => {
      expect(evaluateSuggestions(undefined, customer, lookups)).toEqual({});
    });
  });
});
