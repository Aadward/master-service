import { describe, it, expect } from "vitest";
import { evalExpression, evaluateSuggestions } from "./expression-evaluator";
import type { CustomerMinData } from "./types";

const customer: CustomerMinData = {
  customerId: "C0001",
  custNo: "100001",
  custName: "WOODY",
  globalCustNo: "900001",
  globalCustName: "WOODY Global",
  globalCustCode: "WDY",
  regionNo: "10006",
  companyNo: "1001",
  isMaster: true,
  isInterCompany: false,
  customerType: "standard_b2b",
  // 扁平化的 location 字段（纯数字 loc_no, < 2000）
  mfg_loc_no: "1234",
  sales_loc_no: "567",
};

const lookups = {
  currency_by_region: { "10001": "USD", "10002": "EUR", "10006": "JPY", "10007": "CNY" },
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
      expect(evalExpression("${customer.regionNo}", customer, lookups)).toBe("10006");
      expect(evalExpression("${customer.custName}", customer, lookups)).toBe("WOODY");
    });

    it("preserves non-string types when whole-string is an expression", () => {
      const customer2 = { ...customer, regionNo: null };
      expect(evalExpression("${customer.regionNo}", customer2, lookups)).toBe(null);
    });

    it("looks up via lookup.X[customer.Y]", () => {
      expect(
        evalExpression("${lookup.currency_by_region[customer.regionNo]}", customer, lookups)
      ).toBe("JPY");
    });

    it("returns undefined for missing lookup key", () => {
      const cust = { ...customer, regionNo: "99999" };
      expect(
        evalExpression("${lookup.currency_by_region[customer.regionNo]}", cust, lookups)
      ).toBe(undefined);
    });

    it("supports boolean ternary on flat fields", () => {
      expect(
        evalExpression("${customer.isMaster == true ? 500000 : 100000}", customer, lookups)
      ).toBe(500000);
      const nonMaster = { ...customer, isMaster: false };
      expect(
        evalExpression("${customer.isMaster == true ? 500000 : 100000}", nonMaster, lookups)
      ).toBe(100000);
    });

    it("supports string-equality ternary", () => {
      expect(
        evalExpression("${customer.regionNo == '10006' ? 'foreign' : 'domestic'}", customer, lookups)
      ).toBe("foreign");
    });

    it("interpolates inline ${...} inside larger string", () => {
      expect(
        evalExpression("${customer.regionNo}_${customer.companyNo}", customer, lookups)
      ).toBe("10006_1001");
    });

    it("references flat location fields (mfg_loc_no / sales_loc_no)", () => {
      expect(evalExpression("${customer.mfg_loc_no}", customer, lookups)).toBe("1234");
      expect(evalExpression("${customer.sales_loc_no}", customer, lookups)).toBe("567");
    });

    it("treats unknown identifiers as undefined (defensive)", () => {
      const v = evalExpression("${customer.nonexistent}", customer, lookups);
      expect(v).toBe(undefined);
    });

    it("does NOT support nested ternaries (current limitation, document via test)", () => {
      // Single-level ternary is fine
      expect(
        evalExpression("${customer.isMaster == true ? 'A' : 'B'}", customer, lookups)
      ).toBe("A");

      // Nested ternary won't evaluate correctly — first ':' is consumed by outer
      // 模板里若需要 3 路条件，请拆成多条 suggestion 字段（参见 standard_b2b.yaml 注释）
      const nested = evalExpression(
        "${customer.isMaster == true ? 'OUTER_TRUE' : (customer.isInterCompany == true ? 'INNER_TRUE' : 'INNER_FALSE')}",
        { ...customer, isMaster: false, isInterCompany: true },
        lookups
      );
      // 期望值: 不是 'INNER_TRUE'（因为 evaluator 不支持嵌套）
      // 实际行为：把 falseStr "(...)" 当作引用，返回原 ref 串或 undefined
      expect(nested).not.toBe("INNER_TRUE");
    });
  });

  describe("evaluateSuggestions", () => {
    it("evaluates each rule independently", () => {
      const out = evaluateSuggestions(
        {
          currency: "${lookup.currency_by_region[customer.regionNo]}",
          tax_region: "${customer.regionNo}",
          payment_terms: "NET30",
          credit: "${customer.isMaster == true ? 500000 : 100000}",
          default_mfg_loc: "${customer.mfg_loc_no}",
        },
        customer,
        lookups
      );
      expect(out).toEqual({
        currency: "JPY",
        tax_region: "10006",
        payment_terms: "NET30",
        credit: 500000,
        default_mfg_loc: "1234",
      });
    });

    it("returns empty object for undefined rules", () => {
      expect(evaluateSuggestions(undefined, customer, lookups)).toEqual({});
    });
  });
});
