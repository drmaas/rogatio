import type { RuntimeError, RuntimeErrorCode, RuntimeResult } from "./types.js";

function runtimeError(code: RuntimeErrorCode): RuntimeError {
  return { code };
}

export function failure<T>(code: RuntimeErrorCode): RuntimeResult<T> {
  return { ok: false, error: runtimeError(code) };
}
