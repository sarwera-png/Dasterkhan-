# CLAUDE.md — Dastarkhwan Assistant

## Purpose

Karachi Dastarkhwan is a restaurant web app with an AI chat assistant, **Dastarkhwan Assistant**.

This is a **classroom training demo** for a **fictional** restaurant (Karachi Dastarkhwan, Gulshan-e-Iqbal, Karachi). It is not a real business.

- Website language: **English + Urdu**.
- Business facts (name, menu, prices, hours, contact) must be easy to replace, so the build can later be adapted to another real restaurant with confirmed facts.

## Architecture Overview

```
frontend/   index.html, styles.css, app.js   -> the website and chat UI
backend/                                     -> server code; calls the AI model, keeps keys server-side
data/                                        -> approved business facts (single source of truth)
prompts/                                     -> assistant prompts and instructions
README.md
```

Flow: browser (`frontend/`) -> backend -> AI model, with the backend reading facts from `data/` and instructions from `prompts/`.

## Approved Facts Only

- Never invent prices, menu items, timings, discounts, or any business facts.
- Use only facts approved by the owner, stored in `data/`.
- If a fact is missing, leave a clearly marked placeholder or ask the owner. Do not guess.
- Keep all business facts in `data/`. Do not hardcode them in HTML, JS, or prompts, so they can be swapped for another restaurant.
- The assistant must say it does not know when a fact is not in `data/`.

## Coding Rules

- Keep it simple and minimal; prefer plain HTML, CSS, and JavaScript unless the owner says otherwise.
- Match the style of the surrounding code.
- All user-facing text must exist in both English and Urdu; the Urdu layout must support right-to-left (RTL).
- No unrequested features, dependencies, or refactors.
- Work one feature at a time: build, test, then wait for the owner before starting the next.

## Security Rules

- Never commit or print secrets (`.env`, API keys, tokens). Keep `.env` in `.gitignore`.
- API keys live only on the backend, never in `frontend/`.
- Treat all user input as untrusted: validate on the backend and escape it when rendering.
- Do not run `git commit` or `git push` unless the owner explicitly asks.

## Token-Saving Rules

- Read only the files needed for the current task; do not scan the whole repo.
- Use targeted search instead of reading whole files when possible.
- Do not re-read files just edited or repeat information already established.
- Keep replies short; report results, not narration.
- Keep prompts and data files concise.

## Scope Rule

**Only modify files needed for the current task.** Do not touch unrelated files, and do not reformat or reorganize code you were not asked to change.
