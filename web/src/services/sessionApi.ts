/**
 * sessionApi.ts — Artise Biomedical project session integration for SigmaCog EEG app
 * Reads session_token from URL, fetches subject info, uploads CSV and result data.
 */

const ARTISEBIO_API = 'https://www.sigmacog.xyz/api';

export interface SessionInfo {
  sessionId: number;
  sessionToken: string;
  name: string;
  gender: string;
  birth_date: string | null;
  notes: string | null;
  subject_id: string | null;
}

/** Read session_token from URL params. Returns null if not present. */
export function getSessionTokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('session_token');
}

/** Fetch session info from backend using the JWT token. */
export async function fetchSessionInfo(token: string): Promise<SessionInfo | null> {
  try {
    const r = await fetch(`${ARTISEBIO_API}/sessions/token/${encodeURIComponent(token)}`);
    if (!r.ok) return null;
    const d = await r.json() as {
      session_id: number;
      client_name?: string;
      name?: string;
      gender?: string;
      birth_date?: string;
      notes?: string;
      subject_id?: string;
    };
    return {
      sessionId:    d.session_id,
      sessionToken: token,
      name:         d.client_name || d.name || '',
      gender:       d.gender || '',
      birth_date:   d.birth_date || null,
      notes:        d.notes || null,
      subject_id:   d.subject_id || null,
    };
  } catch {
    return null;
  }
}

/** Upload raw CSV content to the session. Fire-and-forget. */
export function uploadSessionCsv(
  sessionId: number,
  sessionToken: string,
  csvContent: string,
  filename: string,
): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const fd = new FormData();
  fd.append('session_token', sessionToken);
  fd.append('file', blob, filename);
  fetch(`${ARTISEBIO_API}/sessions/${sessionId}/upload-csv`, { method: 'POST', body: fd })
    .catch(() => { /* ignore */ });
}

/** Mark session as completed with optional metrics and report HTML. Fire-and-forget. */
export function saveSessionResult(
  sessionId: number,
  sessionToken: string,
  results: Record<string, unknown>,
  reportHtml?: string,
): void {
  fetch(`${ARTISEBIO_API}/sessions/${sessionId}/result`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_token: sessionToken,
      results,
      report_html: reportHtml || undefined,
    }),
  }).catch(() => { /* ignore */ });
}
