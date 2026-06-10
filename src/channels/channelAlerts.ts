import type { LookupResult } from "../core/types.js";
import type { AlertService } from "../observability/alertService.js";

export type AlertSender = Pick<AlertService, "send">;

export async function alertOnLookupDependencyError(
  alerts: AlertSender | undefined,
  channel: "line" | "telegram",
  result: LookupResult
): Promise<void> {
  if (result.status !== "dependency_error") return;

  await alerts?.send(
    `lookup_dependency_error:${channel}:${result.reason}`,
    `Lookup dependency error on ${channel}: ${result.reason}. Staff received the safe fallback; check SML MCP/readiness.`
  );
}
