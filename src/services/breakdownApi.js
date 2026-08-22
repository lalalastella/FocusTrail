import { API_BASE } from '../config/runtime';
import { createDemoBreakdown } from './demoFallback';

export async function postBreakdownRequest(payload, { signal } = {}) {
  const runBrowserFallback = async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    return createDemoBreakdown(payload);
  };

  if (!API_BASE) return runBrowserFallback();

  try {
    const response = await fetch(`${API_BASE}/api/breakdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = { error: 'Breakdown request returned an invalid response.' };
    }

    if (!response.ok) {
      const suffix = data.requestId ? ` (requestId: ${data.requestId})` : '';
      throw new Error(`${data.error || 'Breakdown request failed'}${suffix}`);
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return runBrowserFallback();
  }
}
