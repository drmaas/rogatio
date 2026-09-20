import {
  matchUrlCaptures,
  type RogatioQueryAction,
  substituteUrlCaptures,
} from "@rogatio/schema";
import { failure } from "./errors.js";
import type { RuntimeResult } from "./types.js";

export interface UrlCaptureTransformContext {
  readonly url: string;
  readonly urlRegex: string;
}

export interface HeaderCaptureAction {
  readonly operation: "set" | "append";
  readonly name: string;
  readonly value: string;
}

function capturesFor(
  context: UrlCaptureTransformContext,
): RuntimeResult<readonly (string | undefined)[]> {
  const captures = matchUrlCaptures(context.urlRegex, context.url);
  return captures === null
    ? failure("runtime.url-capture-mismatch")
    : { ok: true, value: captures };
}

export function rewriteQueryWithUrlCaptures(
  context: UrlCaptureTransformContext,
  action: RogatioQueryAction,
): RuntimeResult<string> {
  const captures = capturesFor(context);
  if (!captures.ok) return captures;
  let parsed: URL;
  try {
    parsed = new URL(context.url);
  } catch {
    return failure("runtime.invalid-target");
  }
  for (const param of action.params) {
    const operation = param.operation ?? "set";
    if (operation === "remove") {
      parsed.searchParams.delete(param.name);
    } else if (param.value !== undefined) {
      parsed.searchParams.set(
        param.name,
        substituteUrlCaptures(param.value, captures.value),
      );
    }
  }
  return { ok: true, value: parsed.toString() };
}

export function rewriteHeadersWithUrlCaptures(
  context: UrlCaptureTransformContext,
  headers: Readonly<Record<string, string>>,
  actions: readonly HeaderCaptureAction[],
): RuntimeResult<Record<string, string>> {
  const captures = capturesFor(context);
  if (!captures.ok) return captures;
  const output: Record<string, string> = { ...headers };
  for (const action of actions) {
    const value = substituteUrlCaptures(action.value, captures.value);
    const existingKey = Object.keys(output).find(
      (key) => key.toLowerCase() === action.name.toLowerCase(),
    );
    if (action.operation === "append" && existingKey !== undefined) {
      output[existingKey] = `${output[existingKey]}, ${value}`;
    } else if (existingKey !== undefined) {
      output[existingKey] = value;
    } else {
      output[action.name] = value;
    }
  }
  return { ok: true, value: output };
}
