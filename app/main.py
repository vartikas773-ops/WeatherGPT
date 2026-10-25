import os
import time
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE = Path(__file__).resolve().parent.parent

from .envload import load_env  # noqa: E402

ENV_NOTE = load_env(BASE)  # local: reads .env. On Vercel: uses dashboard env vars.

from . import summary, weather  # noqa: E402

summary.ENV_NOTE = ENV_NOTE

PUBLIC = BASE / "public"
app = FastAPI(title="WeatherGPT")


class RevalidatingStatic(StaticFiles):
    """Local dev: always revalidate so edited JS/CSS isn't served stale."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


# On Vercel, files in public/** are served from the CDN before this app is reached.
# This mount and the "/" route below are what serve them when running locally.
app.mount("/static", RevalidatingStatic(directory=PUBLIC / "static", check_dir=False), name="static")

Units = Literal["metric", "imperial"]
_summaries: dict = {}
SUMMARY_TTL = 1800  # seconds: reuse AI summaries so repeat visits don't spend API quota


@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(PUBLIC / "index.html")


@app.get("/api/env-check")
async def env_check():
    """Whether this server has a Groq key (never the key itself)."""
    return {"groq_key_loaded": bool(os.getenv("GROQ_API_KEY", "").strip())}


@app.get("/api/search")
async def search(q: str = Query(min_length=2, max_length=100)):
    try:
        return await weather.search_places(q)
    except httpx.HTTPError:
        raise HTTPException(502, "Location search is unavailable right now.")


@app.get("/api/reverse")
async def reverse(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)):
    return await weather.reverse_geocode(lat, lon)


@app.get("/api/forecast")
async def forecast(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
                   name: str = Query("Your location", max_length=100), units: Units = "metric"):
    try:
        return await weather.get_forecast(lat, lon, name, units)
    except httpx.HTTPError:
        raise HTTPException(502, "Couldn't reach the weather service. Try again in a moment.")


@app.get("/api/summary")
async def get_summary(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
                      name: str = Query("Your location", max_length=100), units: Units = "metric"):
    key = (round(lat, 2), round(lon, 2), units, name)
    hit = _summaries.get(key)
    if hit and time.time() - hit[0] < SUMMARY_TTL:
        return hit[1]
    try:
        data = await weather.get_forecast(lat, lon, name, units)
    except httpx.HTTPError:
        raise HTTPException(502, "Couldn't reach the weather service.")
    result = await summary.summarize(data)
    if result["source"] == "ai":
        if len(_summaries) > 500:
            _summaries.clear()
        _summaries[key] = (time.time(), result)
    return result
