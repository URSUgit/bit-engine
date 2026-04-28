const BASE = process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? "http://localhost:8080";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body || res.statusText);
  }

  return res.json() as Promise<T>;
}

export const api = {
  traders: {
    list: (params?: Record<string, string>) =>
      request<any[]>(`/api/v1/traders${params ? `?${new URLSearchParams(params)}` : ""}`),
    get: (id: string) => request<any>(`/api/v1/traders/${id}`),
    getPositions: (id: string) => request<any[]>(`/api/v1/traders/${id}/positions`),
  },

  signals: {
    list: (params?: Record<string, string>) =>
      request<any[]>(`/api/v1/signals${params ? `?${new URLSearchParams(params)}` : ""}`),
    latest: () => request<any[]>("/api/v1/signals/latest"),
  },

  portfolio: {
    get: (token: string) =>
      request<any>("/api/v1/portfolio", { headers: { Authorization: `Bearer ${token}` } }),
    positions: (token: string) =>
      request<any[]>("/api/v1/portfolio/positions", { headers: { Authorization: `Bearer ${token}` } }),
    history: (token: string) =>
      request<any[]>("/api/v1/portfolio/history", { headers: { Authorization: `Bearer ${token}` } }),
  },

  copy: {
    start: (traderId: string, config: any, token: string) =>
      request<any>("/api/v1/copy", {
        method: "POST",
        body: JSON.stringify({ traderId, ...config }),
        headers: { Authorization: `Bearer ${token}` },
      }),
    stop: (copyId: string, token: string) =>
      request<any>(`/api/v1/copy/${copyId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }),
  },
};
