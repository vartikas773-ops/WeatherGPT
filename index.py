"""Vercel entrypoint: exposes the FastAPI instance named `app`."""
from fastapi import FastAPI  # noqa: F401  (lets Vercel's framework detection see FastAPI)

from app.main import app  # noqa: F401
