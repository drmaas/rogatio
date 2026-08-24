import type { CapabilityProfile, RuntimeActivation } from "./f14-lifecycle.js";

export interface InterceptionProvider {
  readonly platform: string;
  detect(): CapabilityProfile;
  start(activation: RuntimeActivation): Promise<void>;
  stop(): Promise<void>;
}

export type InterceptionOutcome =
  | { readonly kind: "active"; readonly provider: string }
  | { readonly kind: "unsupported"; readonly reasons: string[] };

let registeredProvider: InterceptionProvider | null = null;

/** Register the platform-specific interception provider (used by F15/F17). */
export function registerInterceptionProvider(
  provider: InterceptionProvider,
): void {
  registeredProvider = provider;
}

export function getInterceptionProvider(): InterceptionProvider | null {
  return registeredProvider;
}

/**
 * Capability-gated interception entry point. With no registered provider (this
 * scope) interception is `unsupported`; activation is never performed unless the
 * provider reports a supported capability profile.
 */
export async function startInterception(
  activation: RuntimeActivation,
): Promise<InterceptionOutcome> {
  if (registeredProvider === null) {
    return { kind: "unsupported", reasons: ["no-interception-provider"] };
  }
  const capabilities = registeredProvider.detect();
  if (!capabilities.supported) {
    return { kind: "unsupported", reasons: capabilities.reasons };
  }
  await registeredProvider.start(activation);
  return { kind: "active", provider: registeredProvider.platform };
}

export async function stopInterception(): Promise<void> {
  if (registeredProvider === null) return;
  await registeredProvider.stop();
}
