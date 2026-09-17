/**
 * Install a script that runs before every document via CDP
 * (`Page.addScriptToEvaluateOnNewDocument`). Prefer `page.addInitScript`.
 */
export function serializeChromeMock(
  script: (...args: never[]) => unknown,
  arg?: unknown,
): string {
  if (arg === undefined) return `(${script.toString()})();`;
  return `(${script.toString()})(${JSON.stringify(arg)});`;
}
