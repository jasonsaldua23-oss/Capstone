/**
 * Hands the user a sign-in response just confirmed to the portal page it opens.
 *
 * Without it the portal page asked /api/auth/me for the same user again before it
 * mounted, so a full round trip to the API sat between "Login successful" and the
 * portal starting to load its data. The portal still calls /api/auth/me in the
 * background, and that answer remains the authority (a 401 signs the tab out).
 *
 * Safety: the hand-off lives in this tab's sessionStorage, is read once, expires
 * after a minute, and is honoured only while the tab still holds the very session
 * token the sign-in issued. It carries a tail of that token, never the token itself.
 */

type HandoffStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const KEY = 'login-handoff'
const TOKEN_TAIL_LENGTH = 24
export const LOGIN_HANDOFF_MAX_AGE_MS = 60_000

const tokenTail = (token: string) => token.slice(-TOKEN_TAIL_LENGTH)

export function writeLoginHandoff(
  storage: HandoffStorage,
  { user, token, rememberMe, now = Date.now() }: { user: object; token: string; rememberMe: boolean; now?: number },
) {
  try {
    // /api/auth/me returns the account payload plus the signed remember-me choice.
    storage.setItem(KEY, JSON.stringify({ user: { ...user, rememberMe }, tokenTail: tokenTail(token), at: now }))
  } catch {
    // Without browser storage the portal simply asks the server, as before.
  }
}

export function takeLoginHandoff<User extends object = Record<string, unknown>>(
  storage: HandoffStorage,
  { token, now = Date.now() }: { token: string | null; now?: number },
): User | null {
  let raw: string | null = null
  try {
    raw = storage.getItem(KEY)
    // One use only: a reload or a later visit always restores from the server.
    if (raw !== null) storage.removeItem(KEY)
  } catch {
    return null
  }
  if (!raw || !token) return null
  try {
    const handoff = JSON.parse(raw)
    const user = handoff?.user
    const age = now - Number(handoff?.at)
    if (!user || typeof user !== 'object' || !user.id || !user.email) return null
    if (!(age >= 0 && age <= LOGIN_HANDOFF_MAX_AGE_MS)) return null
    if (handoff.tokenTail !== tokenTail(token)) return null
    return user as User
  } catch {
    return null
  }
}
