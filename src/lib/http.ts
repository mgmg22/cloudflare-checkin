/** 最小 fetch 封装：POST JSON，返回 [status, json|{raw}]，网络异常返回 [0, {error}]。 */

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown = {},
  timeoutMs = 15000,
): Promise<[number, any]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: ctrl.signal,
    });
    let data: any;
    try {
      data = await res.json();
    } catch {
      data = { raw: (await res.text().catch(() => "")).slice(0, 300) };
    }
    return [res.status, data];
  } catch (e: any) {
    return [0, { error: String(e?.message || e) }];
  } finally {
    clearTimeout(t);
  }
}

/** 与 postJson 相同但方法可选（MiniMax 需要 GET 带签名 query）。 */
export async function requestJson(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown,
  timeoutMs = 15000,
): Promise<[number, any]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const init: RequestInit = {
      method: method.toUpperCase(),
      headers,
      signal: ctrl.signal,
    };
    if (body !== undefined && method.toUpperCase() !== "GET") {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await fetch(url, init);
    let data: any;
    try {
      data = await res.json();
    } catch {
      data = { raw: (await res.text().catch(() => "")).slice(0, 300) };
    }
    return [res.status, data];
  } catch (e: any) {
    return [0, { error: String(e?.message || e) }];
  } finally {
    clearTimeout(t);
  }
}
