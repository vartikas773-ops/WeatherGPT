"""Finds and loads the project's .env, and explains what it found.

Handles the Windows gotchas that make a key look "missing":
a .env saved as UTF-16 (PowerShell `echo > .env`), a UTF-8 BOM, or a file
named .env.txt.
"""
import io
import os
from pathlib import Path

from dotenv import dotenv_values


def _read(path: Path) -> str:
    raw = path.read_bytes()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    return raw.decode("utf-8-sig")


def load_env(project_root: Path) -> str:
    """Load the first .env found and return a one-line status for logs and the UI."""
    folders = []
    for f in (project_root, Path(__file__).resolve().parent, Path.cwd()):
        if f not in folders:
            folders.append(f)

    for folder in folders:
        path = folder / ".env"
        if not path.is_file():
            continue
        try:
            values = dotenv_values(stream=io.StringIO(_read(path)))
        except Exception as e:
            note = f"Found {path} but couldn't read it ({e}). Save it as plain UTF-8 text."
            print(f"[env] {note}")
            return note
        for k, v in values.items():
            if v:
                os.environ[k] = v.strip()
        if os.getenv("GROQ_API_KEY", "").strip():
            note = f"Loaded {path}."
        else:
            names = ", ".join(values) or "nothing"
            note = (f"Found {path} but it has no GROQ_API_KEY value (it contains: {names}). "
                    "Use a line like GROQ_API_KEY=gsk_... with no spaces around the =.")
        print(f"[env] {note}")
        return note

    if os.getenv("GROQ_API_KEY", "").strip():
        note = "Using GROQ_API_KEY from the environment."
        print(f"[env] {note}")
        return note
    if os.getenv("VERCEL"):
        note = ("GROQ_API_KEY isn't set. Add it in Vercel: Project > Settings > "
                "Environment Variables, then redeploy.")
        print(f"[env] {note}")
        return note

    hint = ""
    for folder in folders:
        if (folder / ".env.txt").is_file():
            hint = f" Found {folder / '.env.txt'}: rename it to .env."
            break
    note = f"No .env file found. Create one at {project_root / '.env'}.{hint}"
    print(f"[env] {note}")
    return note
