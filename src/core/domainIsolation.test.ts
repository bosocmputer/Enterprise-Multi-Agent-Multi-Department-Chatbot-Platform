import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const tenantSpecificTerms = ["ปูน", "น้ำมัน", "Beger", "Bosch", "ผ้าเบรค", "หัวเทียน", "vios"];

describe("domain isolation", () => {
  it("keeps tenant-specific vocabulary out of runtime source", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      const content = readFileSync(file, "utf8");
      for (const term of tenantSpecificTerms) {
        if (content.includes(term)) {
          violations.push(`${file.replace(process.cwd(), ".")}: ${term}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    if (!path.endsWith(".ts") || path.endsWith(".test.ts")) return [];
    return [path];
  });
}
