/** 通知渠道：server酱 + 钉钉机器人。
 *  职责边界：只做消息推送的 HTTP 封装，不含任何业务判断；
 *  钉钉加签协议 sign = quote(base64(hmac_sha256(secret, "{ts}\n{secret}")))，无 secret 时直发。 */

/** server酱：sctapi.ftqq.com/{key}.send，desp 按 Markdown 渲染，单个 \n 转 \n\n 分段。 */
export async function notifyServerJ(
  title: string,
  content: string,
  pushKey?: string,
): Promise<void> {
  if (!pushKey) return;
  const url = `https://sctapi.ftqq.com/${pushKey}.send`;
  const body = `text=${encodeURIComponent(title)}&desp=${encodeURIComponent(
    content.replace(/\n/g, "\n\n"),
  )}`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (e) {
    console.warn("[notify] server酱推送失败:", e);
  }
}

/** 钉钉机器人：markdown 消息（对齐 py dingding_bot_with_key）。
 *  token 未配置时静默跳过；配置 secret 时按官方加签协议附 timestamp+sign。 */
export async function notifyDingding(
  title: string,
  content: string,
  token?: string,
  secret?: string,
): Promise<void> {
  if (!token) return;
  let url = `https://oapi.dingtalk.com/robot/send?access_token=${token}`;
  if (secret) {
    const ts = Date.now();
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}\n${secret}`)),
    );
    let bin = "";
    for (let i = 0; i < mac.length; i++) bin += String.fromCharCode(mac[i]);
    url += `&timestamp=${ts}&sign=${encodeURIComponent(btoa(bin))}`;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify({ msgtype: "markdown", markdown: { title, text: content } }),
    });
    const data: any = await res.json().catch(() => null);
    if (data?.errcode === 0) console.log("[notify] 钉钉推送成功");
    else console.warn("[notify] 钉钉推送失败:", JSON.stringify(data).slice(0, 200));
  } catch (e) {
    console.warn("[notify] 钉钉推送失败:", e);
  }
}
