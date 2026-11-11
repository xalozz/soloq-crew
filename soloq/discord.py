"""Avisos a un canal de Discord por webhook (port de discord.mjs). Sin webhook no hace nada."""

import json
import math
import time

import httpx

from . import config


def cut(s, n):
    if s is None:
        return s
    s = str(s)
    # JS cuenta en unidades UTF-16; los emojis cuentan doble
    if _len16(s) > n:
        return _slice16(s, n - 1) + "…"
    return s


def _len16(s):
    return len(s.encode("utf-16-le")) // 2


def _slice16(s, n):
    b = s.encode("utf-16-le")[: n * 2]
    return b.decode("utf-16-le", errors="ignore")


def clamp_embed(e):
    out = dict(e)
    if out.get("title"):
        out["title"] = cut(out["title"], 256)
    if out.get("description"):
        out["description"] = cut(out["description"], 4000)
    if out.get("fields"):
        out["fields"] = [{**f, "name": cut(f["name"], 256), "value": cut(f.get("value") or "–", 1024)} for f in out["fields"][:25]]
    if (out.get("footer") or {}).get("text"):
        out["footer"] = {**out["footer"], "text": cut(out["footer"]["text"], 2048)}
    if (out.get("author") or {}).get("name"):
        out["author"] = {**out["author"], "name": cut(out["author"]["name"], 256)}
    return out


def embed_size(e):
    parts = [e.get("title"), e.get("description"), (e.get("footer") or {}).get("text"), (e.get("author") or {}).get("name")]
    for f in e.get("fields") or []:
        parts += [f.get("name"), f.get("value")]
    return sum(_len16(str(s)) for s in parts if s)


def batches(embeds):
    out, cur, size = [], [], 0
    for e in embeds:
        n = embed_size(e)
        if cur and (len(cur) == 10 or size + n > 5800):
            out.append(cur)
            cur, size = [], 0
        cur.append(e)
        size += n
    if cur:
        out.append(cur)
    return out


def send_discord(embeds, content=None, url=None, sleep=time.sleep, http=None):
    url = url if url is not None else config.DISCORD_WEBHOOK
    if not url:
        return {"ok": False, "skipped": True}
    lst = batches([clamp_embed(e) for e in embeds])
    if not lst and content:
        lst.append([])
    client = http or httpx.Client(timeout=15)
    avatar = f"{config.SITE}apple-touch-icon.png"
    for i, chunk in enumerate(lst):
        body = {"username": "SoloQ Crew", "avatar_url": avatar, "allowed_mentions": {"parse": []}, "embeds": chunk}
        if i == 0 and content:
            body["content"] = cut(content, 2000)
        sent = False
        for attempt in range(4):
            try:
                res = client.post(f"{url}{'&' if '?' in url else '?'}wait=true", content=json.dumps(body, ensure_ascii=False).encode(),
                                  headers={"Content-Type": "application/json"})
            except httpx.HTTPError as err:
                if attempt == 3:
                    return {"ok": False, "error": str(err) or type(err).__name__, "sentBatches": i}
                sleep(2 * (attempt + 1))
                continue
            if res.is_success:
                sent = True
                break
            if res.status_code == 429:
                try:
                    ra = float(res.json().get("retry_after") or 2)
                except Exception:
                    ra = 2
                sleep((math.ceil(ra * 1000) + 250) / 1000)
                continue
            if res.status_code >= 500:
                sleep(2 * (attempt + 1))
                continue
            return {"ok": False, "error": f"HTTP {res.status_code}: {res.text[:200]}", "sentBatches": i}
        if not sent:
            return {"ok": False, "error": "demasiados reintentos", "sentBatches": i}
        if i < len(lst) - 1:
            sleep(0.7)
    return {"ok": True}
