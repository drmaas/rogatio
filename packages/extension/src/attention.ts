/**
 * Pure Workspace attention copy from badge + rule statuses (ADR 0010 / AC5).
 * Prefer automatic DNR reconcile over inventing recovery strings.
 */

export interface AttentionExplanation {
  readonly blocking: string;
  readonly explanation: string;
  readonly fix: string;
}

const ATTENTION_PRECEDENCE: readonly string[] = [
  "error",
  "needs runtime",
  "unsupported",
];

export function attentionFromRuleStatuses(input: {
  readonly attention: boolean;
  readonly statuses: readonly Readonly<Record<string, unknown>>[];
}): AttentionExplanation | null {
  if (input.attention !== true) return null;
  for (const blocking of ATTENTION_PRECEDENCE) {
    if (!input.statuses.some((status) => status.status === blocking)) {
      continue;
    }
    if (blocking === "error") {
      // Reconcile (P1–P3a) clears false "not installed" after SW restart.
      // Do not primary-push re-activate/restart-runtime for this class, and
      // do not invent an unproven "reload the extension" string (ADR 0010).
      return {
        blocking: "rules failed to install: see the rule error",
        explanation: "some rules failed to install.",
        fix: "Click the error status for the failed rule.",
      };
    }
    if (blocking === "needs runtime") {
      if (everyNeedsRuntimeIsUnroutable(input.statuses)) {
        return {
          blocking: "needs runtime: source has no PAC route",
          explanation:
            "some body rules use a URL pattern the proxy cannot route.",
          fix: "Use an exact host or an exact URL.",
        };
      }
      return {
        blocking: "needs runtime: start the native runtime",
        explanation: "some rules need the native runtime.",
        fix: "Click 'Start runtime'.",
      };
    }
    return {
      blocking: "unsupported rules: no action available",
      explanation: "some rules are unsupported in this browser.",
      fix: "",
    };
  }
  return null;
}

function everyNeedsRuntimeIsUnroutable(
  statuses: readonly Readonly<Record<string, unknown>>[],
): boolean {
  const needsRuntime = statuses.filter(
    (status) => status.status === "needs runtime",
  );
  if (needsRuntime.length === 0) return false;
  return needsRuntime.every((status) => hasPacUnroutable(status.diagnostics));
}

function hasPacUnroutable(diagnostics: unknown): boolean {
  if (!Array.isArray(diagnostics)) return false;
  return diagnostics.some((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    if (!Object.hasOwn(entry, "code")) return false;
    return (entry as { code?: unknown }).code === "runtime.pac-unroutable";
  });
}
