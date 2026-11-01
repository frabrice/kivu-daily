// Whose dashboard the MD has open (Admin > Open a dashboard). Kept for this
// browser tab only (sessionStorage), so a reload stays in the view and a new
// tab or a new sign-in starts as the MD. No imports: supabase.ts reads it.
// The server only honours it for the MD (viewing_as(), migration
// 20261101210000).

export interface ViewAs { id: string; name: string; session: string }

const KEY = 'kd-view-as';

function read(): ViewAs | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    return v && typeof v.id === 'string' && typeof v.session === 'string' ? v : null;
  } catch {
    return null;
  }
}

let current: ViewAs | null = read();

export const getViewAs = () => current;

export function setViewAs(v: ViewAs | null) {
  current = v;
  try {
    if (v) sessionStorage.setItem(KEY, JSON.stringify(v));
    else sessionStorage.removeItem(KEY);
  } catch { /* private window: lasts until reload */ }
}
