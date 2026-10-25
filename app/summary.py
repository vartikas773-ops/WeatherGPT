"""Writes the plain-English forecast summary.

Uses Groq (OpenAI-compatible chat API) if GROQ_API_KEY is set in .env,
otherwise a simple rule-based fallback so the app works with zero config.
"""
import os
import re

import httpx

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
ENV_NOTE = ""  # set by main.py: what happened when .env was loaded

SYSTEM = (
    "You are a friendly weather presenter. Write a 3-4 sentence forecast summary "
    "from the data provided. Mention how it feels now, how the day and the next "
    "few days trend, and one practical tip (umbrella, layers, sunscreen...). "
    "Plain text only: no markdown, no lists, no emojis. Use the units given."
)


def _facts(f: dict) -> str:
    u, c = f["units"]["temp"], f["current"]
    nxt = f["hourly"][:12]
    lines = [
        f"Location: {f['location']['name']}",
        f"Now: {c['temp']}{u} (feels {c['feels']}{u}), {c['label']}, "
        f"humidity {c['humidity']}%, wind {c['wind']} {f['units']['wind']}",
        "Next 12 hours (temp, rain chance): "
        + "; ".join(f"{h['time'][11:16]} {h['temp']}{u} {h['precip']}%" for h in nxt),
        "Daily: "
        + "; ".join(
            f"{d['date']} {d['label']}, {d['min']}-{d['max']}{u}, rain {d['precip']}%"
            for d in f["daily"]
        ),
    ]
    return "\n".join(lines)


def _fallback(f: dict) -> str:
    u, c = f["units"]["temp"], f["current"]
    today = f["daily"][0]
    peak = max(f["hourly"], key=lambda h: h["precip"])
    name = f["location"]["name"]
    where = "where you are" if name == "Your location" else f"in {name}"
    parts = [
        f"It's {round(c['temp'])}{u} {where} with {c['label'].lower()}, "
        f"feeling like {round(c['feels'])}{u}.",
        f"Today ranges from {round(today['min'])}{u} to {round(today['max'])}{u}.",
    ]
    if peak["precip"] >= 40:
        parts.append(f"Rain is most likely around {peak['time'][11:16]} "
                     f"({peak['precip']}% chance), so keep an umbrella close.")
    else:
        parts.append("Rain looks unlikely over the next day.")
    warmest = max(f["daily"], key=lambda d: d["max"])
    parts.append(f"The warmest day this week is {warmest['date']} at {round(warmest['max'])}{u}.")
    return " ".join(parts)


MODELS_URL = "https://api.groq.com/openai/v1/models"
MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]  # tried first, after GROQ_MODEL
_working_model = ""  # remembered once a model succeeds
_SKIP = ("whisper", "guard", "tts", "orpheus", "playai", "embed", "safeguard")
_PREFER = ("llama-3.3-70b", "gpt-oss-120b", "gpt-oss-20b", "llama-4", "qwen", "llama-3.1-8b")


def _api_key() -> str:
    # tolerate stray spaces or quotes pasted into .env
    return os.getenv("GROQ_API_KEY", "").strip().strip("\"'").strip()


def _error_text(r: httpx.Response) -> str:
    try:
        return r.json()["error"]["message"]
    except Exception:
        return r.text[:200]


async def _available_models(client: httpx.AsyncClient, key: str) -> list[str]:
    """Ask Groq which chat models this key can use, best-looking first."""
    r = await client.get(MODELS_URL, headers={"Authorization": f"Bearer {key}"})
    r.raise_for_status()
    ids = [m["id"] for m in r.json().get("data", []) if m.get("active", True)]
    ids = [i for i in ids if not any(bad in i.lower() for bad in _SKIP)]
    ids.sort(key=lambda i: next((n for n, p in enumerate(_PREFER) if p in i), len(_PREFER)))
    return ids[:4]


async def summarize(forecast: dict) -> dict:
    global _working_model
    prompt = _facts(forecast)
    key = _api_key()
    if not key:
        return {"text": _fallback(forecast), "source": "no_key",
                "reason": ENV_NOTE or "Add GROQ_API_KEY to .env."}

    wanted = (_working_model, os.getenv("GROQ_MODEL", "").strip(), *MODELS)
    queue = list(dict.fromkeys(m for m in wanted if m))
    tried: list[str] = []
    discovered = False
    reason = "Groq didn't respond."
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            while queue:
                model = queue.pop(0)
                if model in tried:
                    continue
                tried.append(model)
                r = await client.post(
                    GROQ_URL,
                    headers={"Authorization": f"Bearer {key}"},
                    json={
                        "model": model,
                        "max_tokens": 800,  # headroom: reasoning models spend tokens thinking
                        "temperature": 0.5,
                        "messages": [
                            {"role": "system", "content": SYSTEM},
                            {"role": "user", "content": prompt},
                        ],
                    },
                )
                if r.status_code == 200:
                    text = (r.json()["choices"][0]["message"].get("content") or "").strip()
                    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()  # reasoning models
                    if text:
                        _working_model = model
                        return {"text": text, "source": "ai"}
                    reason = f"Model {model} returned an empty answer."
                    continue
                detail = _error_text(r)
                print(f"[summary] Groq {r.status_code} with model {model}: {detail}")
                if r.status_code in (401, 403):
                    reason = "Groq rejected the API key. Check GROQ_API_KEY in .env."
                    break
                if r.status_code == 429:
                    reason = "Groq's rate limit was reached. Try again in a minute."
                    break
                reason = f"Groq error {r.status_code} (tried {', '.join(tried)}): {detail[:100]}"
                if not queue and not discovered:
                    # every known model failed: ask Groq what this key can actually use
                    discovered = True
                    try:
                        queue = await _available_models(client, key)
                        print(f"[summary] models available to this key: {queue}")
                    except Exception as e:
                        print(f"[summary] couldn't list models: {e!r}")
    except Exception as e:  # network, timeout, bad JSON... never break the page
        print(f"[summary] Groq request failed: {e!r}")
        reason = "Couldn't reach Groq. Check your internet connection."
    return {"text": _fallback(forecast), "source": "basic", "reason": reason}
