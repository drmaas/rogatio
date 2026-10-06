/** Session-rule band for mock redirects and the loopback allow guard. */
export const MOCK_REDIRECT_ID_MIN = 5_000_001;
export const MOCK_REDIRECT_ID_MAX = 6_000_000;
export const MOCK_GUARD_ID = MOCK_REDIRECT_ID_MAX;

export function isMockRedirectId(id: number): boolean {
  return (
    Number.isInteger(id) &&
    id >= MOCK_REDIRECT_ID_MIN &&
    id <= MOCK_REDIRECT_ID_MAX
  );
}
