// Envío de avisos a un canal de Discord mediante webhook (secreto DISCORD_WEBHOOK).
// Si no hay webhook configurado no hace nada.

export const SITE = 'https://xalozz.github.io/soloq-crew/';
const AVATAR = `${SITE}apple-touch-icon.png`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cut = (s, n) => (s == null ? s : String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

// Respeta los límites de Discord (título 256, descripción 4096, 25 campos de 1024…)
export function clampEmbed(e) {
  const out = { ...e };
  if (out.title) out.title = cut(out.title, 256);
  if (out.description) out.description = cut(out.description, 4000);
  if (out.fields) out.fields = out.fields.slice(0, 25).map((f) => ({ ...f, name: cut(f.name, 256), value: cut(f.value || '–', 1024) }));
  if (out.footer?.text) out.footer = { ...out.footer, text: cut(out.footer.text, 2048) };
  if (out.author?.name) out.author = { ...out.author, name: cut(out.author.name, 256) };
  return out;
}

const embedSize = (e) => [e.title, e.description, e.footer?.text, e.author?.name, ...(e.fields ?? []).flatMap((f) => [f.name, f.value])]
  .reduce((n, s) => n + (s ? String(s).length : 0), 0);

// Agrupa los embeds en mensajes de como mucho 10 embeds y 6000 caracteres
function batches(embeds) {
  const out = [];
  let cur = [], size = 0;
  for (const e of embeds) {
    const n = embedSize(e);
    if (cur.length && (cur.length === 10 || size + n > 5800)) { out.push(cur); cur = []; size = 0; }
    cur.push(e); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function sendDiscord(embeds, { content } = {}) {
  const url = process.env.DISCORD_WEBHOOK;
  if (!url) return { ok: false, skipped: true };
  const list = batches(embeds.map(clampEmbed));
  if (!list.length && content) list.push([]);
  for (let i = 0; i < list.length; i++) {
    const body = { username: 'SoloQ Crew', avatar_url: AVATAR, allowed_mentions: { parse: [] }, embeds: list[i] };
    if (i === 0 && content) body.content = cut(content, 2000);
    let sent = false;
    for (let attempt = 0; attempt < 4 && !sent; attempt++) {
      let res;
      try {
        res = await fetch(`${url}${url.includes('?') ? '&' : '?'}wait=true`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
        });
      } catch (err) {
        if (attempt === 3) return { ok: false, error: err.message, sentBatches: i };
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (res.ok) { sent = true; break; }
      if (res.status === 429) {
        const j = await res.json().catch(() => ({}));
        await sleep(Math.ceil((Number(j.retry_after) || 2) * 1000) + 250);
        continue;
      }
      if (res.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
      return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, sentBatches: i };
    }
    if (!sent) return { ok: false, error: 'demasiados reintentos', sentBatches: i };
    if (i < list.length - 1) await sleep(700);
  }
  return { ok: true };
}
