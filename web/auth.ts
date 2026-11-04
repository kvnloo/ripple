/**
 * Review token on the client (tailnet mode; see server/serve.ts --host).
 *
 * Dash opens Ripple as an artifact-stage link, `http://100.x.y.z:<port>/#t=<token>`, inside a
 * WebView. The token rides in the fragment (never sent in the request line or Referer), is kept
 * in sessionStorage, removed from the address bar, and sent as a bearer header on every fetch.
 * Images use `?t=` because they cannot carry headers. Card frames never get this token: each doc
 * gets its own read-only token from GET /api/cards. On loopback there is no token and this is a no-op.
 */
let token = '';

export function initToken(): string {
  const t = new URLSearchParams(location.hash.slice(1)).get('t');
  if (t) {
    try {
      sessionStorage.setItem('ripple_t', t);
    } catch {}
    history.replaceState(null, '', location.pathname + location.search);
  }
  try {
    token = t ?? sessionStorage.getItem('ripple_t') ?? '';
  } catch {
    token = t ?? '';
  }
  if (token) {
    // Every same-origin fetch carries the bearer header; nothing else changes in the app.
    const raw = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const same = url.startsWith('/') || url.startsWith(location.origin + '/');
      if (!same) return raw(input, init);
      const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set('authorization', `Bearer ${token}`);
      return raw(input, { ...init, headers });
    }) as typeof fetch;
  }
  return token;
}

/** Same-origin path + token, for URLs that cannot carry a header (img src). */
export function withT(u: string): string {
  if (!token || !u.startsWith('/')) return u;
  return `${u}${u.includes('?') ? '&' : '?'}t=${token}`;
}

/** Device ids: localStorage may be missing in a WebView or sandbox; never crash on it. */
export function stored(key: string, make: () => string): string {
  try {
    const v = localStorage.getItem(key);
    if (v) return v;
    const n = make();
    localStorage.setItem(key, n);
    return n;
  } catch {
    return make();
  }
}
