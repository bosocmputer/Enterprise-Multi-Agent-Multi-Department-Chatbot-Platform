import { describe, expect, it } from "vitest";
import { loadBusinessProfile } from "../config/businessProfile.js";
import { formatLookupReply } from "./responseFormatter.js";

const profile = loadBusinessProfile("profiles/construction-demo.json");

describe("response formatter", () => {
  it("formats multi-match pages with stable 1-5 selection numbers", () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      code: `A${String(index + 1).padStart(3, "0")}`,
      name: `สินค้า ${index + 1}`
    }));

    const reply = formatLookupReply(
      {
        candidates,
        hasMore: true,
        intent: "price",
        keyword: "สินค้า",
        pageSize: 5,
        pageStart: 5,
        status: "multiple_matches",
        totalFound: 12
      },
      profile
    );

    expect(reply).toContain("แสดง 6-10 จาก 12");
    expect(reply).toContain("1. A006 - สินค้า 6");
    expect(reply).toContain("5. A010 - สินค้า 10");
    expect(reply).toContain("เพิ่ม");
  });
});
