import { describe, expect, it } from "vitest";
import { loadBusinessProfile } from "../config/businessProfile.js";
import { parseLookupQuery } from "./queryParser.js";

const profile = loadBusinessProfile("profiles/construction-demo.json");

describe("parseLookupQuery", () => {
  it("parses clear stock and price question", () => {
    expect(parseLookupQuery("น้ำมัน มีไหม ราคาเท่าไร", profile)).toEqual({
      status: "parsed",
      intent: "stock_price",
      keyword: "น้ำมัน",
      isExactCode: false,
      searchTerms: ["น้ำมัน"]
    });
  });

  it("parses exact code command", () => {
    expect(parseLookupQuery("/stock PAINT-01424", profile)).toEqual({
      status: "parsed",
      intent: "stock",
      keyword: "PAINT-01424",
      isExactCode: true,
      searchTerms: ["PAINT-01424"]
    });
  });

  it("parses embedded Thai stock questions", () => {
    expect(parseLookupQuery("มีปูนเหลือไหม", profile)).toEqual({
      status: "parsed",
      intent: "stock",
      keyword: "ปูน",
      isExactCode: false,
      searchTerms: ["ปูน"]
    });
    expect(parseLookupQuery("มีปูนไหม", profile)).toEqual({
      status: "parsed",
      intent: "stock",
      keyword: "ปูน",
      isExactCode: false,
      searchTerms: ["ปูน"]
    });
  });

  it("keeps product names that start with the Thai existential prefix", () => {
    expect(parseLookupQuery("มีด มีไหม", profile)).toEqual({
      status: "parsed",
      intent: "stock",
      keyword: "มีด",
      isExactCode: false,
      searchTerms: ["มีด"]
    });
  });

  it("expands aliases from the business profile without choosing a product", () => {
    const result = parseLookupQuery("มีปูนตราช้างเหลือไหม", profile);
    expect(result).toMatchObject({
      status: "parsed",
      intent: "stock",
      keyword: "ปูนตราช้าง"
    });
    expect(result.status === "parsed" ? result.searchTerms : []).toEqual(
      expect.arrayContaining(["ปูนตราช้าง", "ปูน ช้าง"])
    );
  });

  it("rejects unsupported chatter", () => {
    expect(parseLookupQuery("สวัสดีครับ", profile)).toEqual({
      status: "unsupported",
      reason: "intent_not_found"
    });
  });
});
