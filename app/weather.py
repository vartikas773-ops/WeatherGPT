"""Open-Meteo client: geocoding + forecast, normalised for the UI."""
import time
import httpx

GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
REVERSE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client"

# WMO weather interpretation codes -> short labels
WMO = {
    0: "Clear sky", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Rime fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain",
    66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Light showers", 81: "Showers", 82: "Violent showers",
    85: "Snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
}

_cache: dict = {}
CACHE_TTL = 600  # seconds


def label_for(code: int) -> str:
    return WMO.get(code, "Unknown")


async def search_places(query: str, count: int = 5) -> list[dict]:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(GEO_URL, params={"name": query, "count": count, "language": "en"})
        r.raise_for_status()
    results = r.json().get("results", [])
    return [
        {
            "name": p["name"],
            "region": ", ".join(x for x in (p.get("admin1"), p.get("country")) if x),
            "lat": p["latitude"],
            "lon": p["longitude"],
        }
        for p in results
    ]


async def get_forecast(lat: float, lon: float, name: str, units: str = "metric") -> dict:
    key = (round(lat, 3), round(lon, 3), units)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return {**hit[1], "location": {"name": name}}

    imperial = units == "imperial"
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,"
                   "weather_code,wind_speed_10m,wind_direction_10m,is_day",
        "hourly": "temperature_2m,precipitation_probability",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,"
                 "precipitation_probability_max,sunrise,sunset",
        "timezone": "auto",
        "forecast_days": 7,
        "temperature_unit": "fahrenheit" if imperial else "celsius",
        "wind_speed_unit": "mph" if imperial else "kmh",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(FORECAST_URL, params=params)
        r.raise_for_status()
    raw = r.json()

    cur = raw["current"]
    start_hour = cur["time"][:13] + ":00"
    times = raw["hourly"]["time"]
    start = next((i for i, t in enumerate(times) if t >= start_hour), 0)
    hourly = [
        {
            "time": times[i],
            "temp": raw["hourly"]["temperature_2m"][i],
            "precip": raw["hourly"]["precipitation_probability"][i] or 0,
        }
        for i in range(start, min(start + 24, len(times)))
    ]

    d = raw["daily"]
    daily = [
        {
            "date": d["time"][i],
            "code": d["weather_code"][i],
            "label": label_for(d["weather_code"][i]),
            "max": d["temperature_2m_max"][i],
            "min": d["temperature_2m_min"][i],
            "precip": d["precipitation_probability_max"][i] or 0,
        }
        for i in range(len(d["time"]))
    ]

    data = {
        "units": {"temp": "°F" if imperial else "°C", "wind": "mph" if imperial else "km/h"},
        "current": {
            "temp": cur["temperature_2m"],
            "feels": cur["apparent_temperature"],
            "humidity": cur["relative_humidity_2m"],
            "wind": cur["wind_speed_10m"],
            "wind_dir": cur.get("wind_direction_10m") or 0,
            "code": cur["weather_code"],
            "label": label_for(cur["weather_code"]),
            "is_day": bool(cur["is_day"]),
            "time": cur["time"],
        },
        "hourly": hourly,
        "daily": daily,
        # local sunrise/sunset for today, used by the UI to pick day / dusk / night
        "sun": {"sunrise": d["sunrise"][0], "sunset": d["sunset"][0]},
    }
    _cache[key] = (time.time(), data)
    return {**data, "location": {"name": name}}


async def reverse_geocode(lat: float, lon: float) -> dict:
    """Turn coordinates into a city name. Never raises: falls back to a generic label."""
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            r = await client.get(REVERSE_URL, params={
                "latitude": lat, "longitude": lon, "localityLanguage": "en"})
            r.raise_for_status()
        j = r.json()
        state = j.get("principalSubdivision") or ""
        name = j.get("city") or j.get("locality") or state
        if name:
            region = ", ".join(x for x in (state if state != name else "", j.get("countryName")) if x)
            return {"name": name, "region": region}
    except Exception as e:
        print(f"[reverse] failed: {e}")
    return {"name": "Your location", "region": ""}
