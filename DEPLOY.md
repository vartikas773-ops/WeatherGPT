# Deploying WeatherGPT to Vercel

## Project layout
```
index.py            Vercel entrypoint (exposes the FastAPI app)
app/                FastAPI backend (main.py, weather.py, summary.py, envload.py)
public/index.html   The page (served from Vercel's CDN)
public/static/      app.js, effects.js, style.css
requirements.txt
```

## Deploy (GitHub, recommended: every push redeploys)
1. Push the project to GitHub. `.env` and `.venv` must NOT be committed (check `.gitignore`).
2. Go to https://vercel.com/new, import the repo, leave all build settings on their defaults.
3. Before clicking Deploy, open **Environment Variables** and add:
   - `GROQ_API_KEY` = your Groq key
4. Deploy. Vercel gives you a `https://<name>.vercel.app` link.

## Deploy (CLI)
```
npm i -g vercel
vercel                      # first deploy (preview)
vercel env add GROQ_API_KEY # paste the key, tick Production
vercel --prod               # go live
```

## Run locally
```
pip install -r requirements.txt
cp .env.example .env        # then put your key in .env
uvicorn app.main:app --reload
```
