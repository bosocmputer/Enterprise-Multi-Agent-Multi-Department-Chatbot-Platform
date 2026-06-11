import { createHash } from "node:crypto";

export function hashIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function hashText(value: string | undefined): string | undefined {
  return hashIdentifier(value);
}
