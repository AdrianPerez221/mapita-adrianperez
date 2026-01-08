export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit & { timeoutMs?: number } = {}) {
    const { timeoutMs = 12000, ...rest } = init;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
  
    try {
      const res = await fetch(input, { ...rest, signal: controller.signal, cache: "no-store" });
      return res;
    } finally {
      clearTimeout(t);
    }
  }
  