const configuredApiBase = String(import.meta.env.VITE_API_BASE || '').trim().replace(/\/$/, '');

export const WEB_DEMO_MODE = import.meta.env.VITE_WEB_DEMO === 'true';

export const API_BASE = configuredApiBase
  || (import.meta.env.DEV ? 'http://localhost:8787' : window.location.origin);

// The desktop monitor uses SSE. Do not keep a same-origin serverless function
// open for it; only an explicitly configured backend enables that stream.
export const HAS_REMOTE_API = Boolean(configuredApiBase);
