import type { RuntimeError, RuntimeErrorCode, RuntimeResult } from "./types.js";

export function runtimeError(code: RuntimeErrorCode): RuntimeError {
  return { code };
}

export function failure<T>(code: RuntimeErrorCode): RuntimeResult<T> {
  return { ok: false, error: runtimeError(code) };
}

export function stableErrorBody(error: RuntimeError): string {
  return JSON.stringify({ ok: false, error: { code: error.code } });
}
