/** 通知：server酱（sctapi.ftqq.com/{key}.send）。desp 按 Markdown 渲染，单个 \n 转 \n\n 分段。 */

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
