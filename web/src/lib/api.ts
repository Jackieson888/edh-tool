import "server-only";

export const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

export async function readBody<T>(req: Request, maxBytes = 200_000): Promise<T | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export const isId = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x);
