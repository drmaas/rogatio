/**
 * Disabled state for the Start/Stop runtime sidebar controls.
 * Start is unavailable while a session is starting or running; Stop is
 * unavailable in every other phase.
 */
export function runtimeControlDisabled(phase: string | undefined): {
  readonly start: boolean;
  readonly stop: boolean;
} {
  const current = phase ?? "stopped";
  const running = current === "started" || current === "starting";
  return { start: running, stop: !running };
}
