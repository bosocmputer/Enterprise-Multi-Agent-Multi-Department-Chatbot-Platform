import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/env.js";

export function requireInternalAuth(
  config: Pick<AppConfig, "INTERNAL_API_TOKEN" | "NODE_ENV">,
  request: FastifyRequest,
  reply: FastifyReply
): boolean {
  if (config.NODE_ENV !== "production") return true;

  const header = request.headers.authorization;
  const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token && token === config.INTERNAL_API_TOKEN) return true;

  void reply.code(401).send({ error: "invalid_internal_token" });
  return false;
}
