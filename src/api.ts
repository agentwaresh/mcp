import { API } from "./config.js";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

async function parse(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: text };
  }
}

/** GET a free endpoint. */
export async function get<T = any>(path: string, query?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const data = await parse(res);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `${path} failed with ${res.status}`, data);
  return data as T;
}

/** POST a JSON body. Returns the parsed body and status, without throwing on 402. */
export async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, ok: res.ok, data: await parse(res), headers: res.headers };
}
