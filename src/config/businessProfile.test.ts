import { describe, expect, it } from "vitest";
import { businessProfileSchema, formatBusinessProfileHelp, loadBusinessProfile } from "./businessProfile.js";

describe("business profile", () => {
  it("loads the construction demo profile", () => {
    const profile = loadBusinessProfile("profiles/construction-demo.json");

    expect(profile).toMatchObject({
      businessType: "construction-materials",
      tenantId: "construction-demo",
      sml: {
        datasetLabel: "construction-demo",
        tenantStatus: "demo"
      }
    });
    expect(formatBusinessProfileHelp(profile)).toContain("มีปูนเหลือไหม");
  });

  it("rejects invalid intent regex patterns", () => {
    const parsed = businessProfileSchema.safeParse({
      businessType: "test",
      intentPatterns: [{ intent: "stock", pattern: "[" }],
      tenantId: "test"
    });

    expect(parsed.success).toBe(false);
  });
});
