import type { NormalizedMatcher, RogatioOperation } from "@rogatio/compiler";
import { matchUrlCaptures, substituteUrlCaptures } from "@rogatio/schema";
import type { ActionPreview } from "./types.js";

function captureSubject(
  matcher: NormalizedMatcher,
  url: string,
): string | null {
  if (matcher.source.key === "url") return url;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * The action preview `rogatio test` prints. Hosts pass this as `previewAction`
 * so a match can show the resulting redirect, query, header, or replace-mode body.
 * Regex-mode bodies stay null: the preview is the replacement text, not a rewrite.
 */
export function previewRuleAction(
  operation: RogatioOperation,
  url: string,
): ActionPreview | null {
  const subject = captureSubject(operation.matcher, url);
  if (subject === null) return null;
  const captures = matchUrlCaptures(operation.matcher.source.value, subject);
  if (captures === null) return null;
  const expand = (value: string): string =>
    substituteUrlCaptures(value, captures);
  if (operation.kind === "redirect") {
    return {
      kind: "redirect",
      summary: expand(operation.redirect.destination),
    };
  }
  if (operation.kind === "query") {
    const values = operation.action.params
      .map((param) =>
        param.operation === "remove"
          ? `${param.name}=<removed>`
          : `${param.name}=${expand(param.value ?? "")}`,
      )
      .join(", ");
    return { kind: "query", summary: values };
  }
  if (operation.kind === "header") {
    if (operation.header.operation === "remove") {
      return { kind: "header", summary: `${operation.header.name}=<removed>` };
    }
    return {
      kind: "header",
      summary: `${operation.header.name}=${expand(operation.header.value ?? "")}`,
    };
  }
  if (
    operation.kind === "request-body" &&
    operation.requestBody.mode === "replace"
  ) {
    return {
      kind: operation.kind,
      summary: expand(operation.requestBody.body),
    };
  }
  if (
    operation.kind === "response-body" &&
    "mode" in operation.responseBody &&
    operation.responseBody.mode === "replace"
  ) {
    return {
      kind: operation.kind,
      summary: expand(operation.responseBody.body),
    };
  }
  return null;
}
