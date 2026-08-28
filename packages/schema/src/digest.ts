export type Sha256Digest = `sha256:${string}`;

export function formatSha256(hex: string): Sha256Digest {
  return `sha256:${hex}`;
}

export function isSha256Digest(value: string): value is Sha256Digest {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}
