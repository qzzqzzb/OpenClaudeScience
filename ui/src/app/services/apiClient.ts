export interface ApiErrorPayload {
  error?: string;
  message?: string;
}

interface NdjsonStreamOptions<T> {
  fallbackMessage: string;
  emptyBodyMessage?: string;
  onMessage: (message: T) => void;
  init?: RequestInit;
}

export function buildQuery(
  params: Record<string, string | number | undefined | null>
): URLSearchParams {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  }

  return query;
}

export async function readJsonResponse<T>(
  response: Response,
  fallbackMessage: string
): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T &
    ApiErrorPayload;

  if (!response.ok) {
    throw new Error(payload.error || payload.message || fallbackMessage);
  }

  return payload;
}

export async function requestJson<T>(
  url: string,
  fallbackMessage: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, options);
  return readJsonResponse<T>(response, fallbackMessage);
}

export async function readNdjsonStream<T>(
  url: string,
  {
    emptyBodyMessage,
    fallbackMessage,
    init,
    onMessage,
  }: NdjsonStreamOptions<T>
): Promise<void> {
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok || !contentType.includes("application/x-ndjson")) {
    const payload = (await response
      .json()
      .catch(() => ({}))) as ApiErrorPayload;
    throw new Error(payload.error || payload.message || fallbackMessage);
  }

  if (!response.body) {
    throw new Error(emptyBodyMessage || fallbackMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      onMessage(JSON.parse(line) as T);
    }

    if (done) {
      break;
    }
  }

  const tail = buffer.trim();
  if (tail) {
    onMessage(JSON.parse(tail) as T);
  }
}
