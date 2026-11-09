// Storage may be disabled by privacy settings or temporary browser restrictions.
// The appearance controls remain fully usable within the current page.
export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function savePreference(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Session-only appearance. */ }
}
