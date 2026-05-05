/**
 * creditApi.ts — Artise credit (service start/end) integration for SigmaCog.
 * Reads steeg_token from the cookie (set by artisebio-web's main.js) and
 * forwards it as a Bearer to the artisebio API. If no cookie, the user is
 * not logged in and the check is skipped silently. If credits are exhausted
 * (403), throws an error with code 'no_credits'.
 *
 * H7 (2026-05-05): localStorage fallback removed. JWT in localStorage is
 * XSS-readable by every script; cookie-only narrows the read path.
 */

const ARTISEBIO_API = 'https://www.sigmacog.xyz/api';

function getAuthToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|;\s*)steeg_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export class NoCreditError extends Error {
  constructor() {
    super('no_credits');
    this.name = 'NoCreditError';
  }
}

/** Call before the service session starts. Returns session_id or null (no token = skip). */
export async function serviceStart(service: string): Promise<number | null> {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const r = await fetch(`${ARTISEBIO_API}/service/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ service }),
    });
    if (r.status === 403) throw new NoCreditError();
    if (!r.ok) return null; // server error — allow through
    const d = await r.json() as { session_id: number };
    return d.session_id;
  } catch (e) {
    if (e instanceof NoCreditError) throw e;
    return null; // network error — allow through
  }
}
