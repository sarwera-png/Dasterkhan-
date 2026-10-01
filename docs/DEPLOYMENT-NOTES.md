# Deployment notes (Vercel) - for the owner to decide later

The code is now **prepared** for Vercel (section 0), but **nothing has been deployed, linked or connected**. The owner decides if and when. This is a fictional training restaurant, so the live site should stay a demo.

## 0. Import steps (Vercel, demo only)

What is already in the repo: `api/index.js` (thin entry that exports the same Express app), `vercel.json` (sends every URL to that function, bundles `backend`, `data`, `frontend`, `prompts`, 60 s limit). `npm start` on the laptop is unchanged: the server only skips `listen` when Vercel sets `VERCEL`.

1. In Vercel: **Add New... > Project > Import Project**, pick the GitHub repository and the branch to deploy. Framework preset **Other**. Leave Build Command, Output Directory and Install Command at their defaults (no build step).
2. Project Settings > General > **Node.js Version: 22.x**.
3. Project Settings > **Environment Variables** (names only here, enter the values in Vercel, never in the repo):
   - `GEMINI_API_KEY` (required for the chat)
   - `GEMINI_FALLBACK_MODELS` (optional)
   - `GEMINI_COOLDOWN_SECONDS` (optional, default 60)
   - `EXTRA_AI_BASE_URL`, `EXTRA_AI_API_KEY`, `EXTRA_AI_MODELS` (optional extra provider, see section 5b; all three or none)
   - Do **not** set `ORDERS_ENABLED` (ordering stays off: the public demo takes no orders).
   - Do **not** set `STAFF_PASSWORD` (the staff dashboard stays locked with 403).
4. Deploy, open the URL, check: website loads, chat answers, no "Confirm order" button, `/staff` shows 403.
5. The 60 s function limit (`maxDuration`) is the highest the free plan allows; the app's own 80 s deadline can be cut short by the platform.

Known limits of the demo on Vercel: chat sessions and carts live in one instance's memory, so a cart can disappear between messages when Vercel uses another instance (a shared session store is needed to fix this). Rate limiting and the model cooldown are also per instance. Orders cannot be saved at all (section 2).

## 1. What must change to run on Vercel (status)

The app is one long-running Express server (`backend/server.js` calls `app.listen`). Vercel runs code as short-lived serverless functions, so it does not fit as is:

- **Express as a function (DONE, see section 0):** the app would need to be exported as a handler (for example an `api/` entry that re-exports the Express app) instead of calling `listen`, and routes (`/api/chat`, `/api/order/confirm`, `/staff`, `/api/staff/*`) mapped to it in a Vercel config file.
- **Static frontend (DONE: served by the same function, bundled via `includeFiles`):** `frontend/` (and `backend/staff/*`, which the server streams from disk) would be served as static files or included in the function bundle; the `express.static` setup would change.
- **In-memory chat sessions are lost:** sessions, carts and the review/confirm state live in the server's memory. Serverless instances are created and dropped at any time and several run side by side, so a customer's next message can land on an instance that has never seen their cart. Sessions need an external store (a database or key-value store) before any real use.
- **Non-persistent file writes:** `data/orders.json` is written at runtime. On Vercel the file system is read-only or temporary and is not shared between instances, so orders would silently disappear or differ per instance. A real database is required.
- **Timeouts:** one chat request may try up to three models (20 s each, 80 s total). Function time limits on the chosen plan must allow this, or the limits need revisiting.
- **HTTPS and proxy:** Vercel terminates HTTPS in front of the app (see section 4 for what that means for the staff lockout).

## 2. Why the live site must run with ORDERS_ENABLED unset

- Ordering is **off by default**: only the exact text `true` turns it on. Unset (or anything else) means demo mode: chat, menu, cart, totals and order review work, but there is no Confirm order button and the confirm endpoint answers `503 ordering_disabled` and writes nothing.
- On serverless, a confirmed order could not be stored safely (section 1), so a customer would be told "order placed" for an order the restaurant never receives. Keeping the switch off makes this impossible.
- It is also a fictional restaurant: no real order should ever be taken.
- Set `ORDERS_ENABLED=true` only on the owner's own machine (own `.env`) or on a host with durable storage, after the storage is replaced with a database.

## 3. Environment variable names needed (names only, never put values in the repo)

| Name | Needed for |
|---|---|
| `GEMINI_API_KEY` | the chat assistant (server side only; without it chat answers with a safe "please contact staff" message) |
| `STAFF_PASSWORD` | the staff dashboard (without it `/staff` is locked with HTTP 403) |
| `ORDERS_ENABLED` | leave **unset** on the public site (section 2) |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` | optional; defaults are in `.env.example` |
| `EXTRA_AI_BASE_URL`, `EXTRA_AI_API_KEY`, `EXTRA_AI_MODELS` | optional extra AI provider (OpenAI-compatible, e.g. Groq), used only after all Gemini models fail; all three or it stays off |
| `GEMINI_COOLDOWN_SECONDS` | optional; seconds to skip a model after 429/503 (default 60, max 300, 0 = off) |
| `PORT` | not used on Vercel; used when running as a normal server |

Set them in the hosting provider's environment settings, never in a committed file.

## 4. Staff dashboard risk on a public URL

- `/staff` uses HTTP Basic authentication with one shared password (`STAFF_PASSWORD`). On a public URL anyone can try passwords; it needs HTTPS and a long random password, and it should not be reachable publicly while ordering is off (there is nothing to manage).
- The lockout (10 failures per 10 minutes) is keyed on `req.ip`. Behind a proxy such as Vercel, the app sees the proxy's address unless Express `trust proxy` is configured correctly, so either all visitors share one counter (an attacker can lock the real staff out) or, with a wrong setting, the client address can be faked. This needs an explicit, correct proxy setting before any public use.
- The lockout counter is also held in memory, so on serverless it resets and is not shared between instances.
- Safer options to consider later: provider-level password protection or IP allow-list for `/staff`, or real user accounts.

## 5. Model quota risk

- The free Gemini tier is rate limited. Under load the provider answers `429` (quota) or `503` (overloaded). The app tries the fallback models in order, and when all fail it gives the customer a safe "please contact staff" message; nothing is invented.
- A classroom or a public link can use up the free quota quickly, and a leaked public URL lets strangers spend it. Consider a paid quota, a per-visitor rate limit on `/api/chat`, and quota alerts.
- Model names and their availability change over time: re-check them on the real key before any launch.

## 5b. Optional extra AI provider (Groq / OpenRouter)

Purpose: when the free Gemini quota is used up (429), the app can try one more provider as a **last resort**, after the whole Gemini chain. It speaks the OpenAI-compatible Chat Completions API, so Groq and OpenRouter work by changing only environment values.

- **Get a free Groq key:** console.groq.com, sign in, **API Keys**, create a key. Keep it only in your own `.env` (laptop) or in the host's environment settings (Vercel), never in the repo or in chat.
- **The three names** (all required, otherwise the provider is off and nothing changes):
  - `EXTRA_AI_BASE_URL`, example value (not a secret): `https://api.groq.com/openai/v1` (https only)
  - `EXTRA_AI_API_KEY`, your key
  - `EXTRA_AI_MODELS`, comma-separated model IDs tried in order. Copy the exact IDs from the Groq console **Models** page and pin them; do not guess, IDs change over time.
- **Free tier limits:** per-minute request and token limits apply, so this is a fallback, not the main provider. A 429 from it starts the same cooldown as for Gemini.
- **Privacy:** while this provider is used, the system prompt, menu data and the customer's messages are sent to that company. Use only the fictional demo data; never type real names, phone numbers or addresses.
- The code keeps every rule (prices, totals, promotions, confirmation, saving orders, the fake-confirmation guard) whichever provider answered. Malformed tool calls from the extra provider fail that attempt and the next model is tried.
- On Vercel, add the three names in the project's Environment Variables like the others (values only there).

## 6. Recommended order of work for guide Prompts 36-37

1. Decide with the owner whether a public site is wanted at all, or if a local/classroom demo is enough (if so, stop here).
2. Keep the live build in demo mode (`ORDERS_ENABLED` unset); run the real-Gemini checklist on the owner's laptop first.
3. Replace `data/orders.json` and in-memory sessions with a real database (this is the V2 work that unlocks ordering).
4. Adapt the Express app for Vercel (handler export, static files, config) and test a preview deployment.
5. Protect `/staff` (correct proxy setting, provider protection, strong password) and add a per-visitor rate limit to the chat.
6. Only then consider switching ordering on, as a separate decision by the owner.
