# WeatherGPT (Python edition)

A Python location-based forecast from Open-Meteo, a Groq-written summary, and a Chart.js
visualisation. 

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # optional: add an API key for AI summaries
uvicorn app.main:app --reload
```

Open http://localhost:8000

## Notes
- Open-Meteo needs no API key.
- Summaries use Groq. Put `GROQ_API_KEY` in `.env` (free key: https://console.groq.com/keys).
  No key? You get a built-in basic summary. Change the model with `GROQ_MODEL`.
- Forecasts are cached in memory for 10 minutes.

## Layout
```
app/main.py       routes: /, /api/search, /api/forecast, /api/summary
app/weather.py    Open-Meteo geocoding + forecast, normalised
app/summary.py    AI summary with a no-key fallback
templates/        index.html
static/           style.css, app.js
```
## Live App:

https://nimbus-nine-lovat.vercel.app/
