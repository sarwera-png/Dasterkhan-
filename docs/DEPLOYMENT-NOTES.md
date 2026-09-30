# Deployment notes (Vercel) - for the owner to decide later

Notes only. Nothing here has been done: no deployment, no Vercel config, no code change. This is a fictional training restaurant, so the live site should stay a demo.

## 1. What must change to run on Vercel

The app is one long-running Express server (`backend/server.js` calls `app.listen`). Vercel runs code as short-lived serverless functions, so it does not fit as is:

- **Express as a function:** the app would need to be exported as a handler (for example an `api/` entry that re-exports the Express app) instead of calling `listen`, and routes (`/api/chat`, `/api/order/confirm`, `/staff`, `/api/staff/*`) mapped to it in a Vercel config file.
- **Static frontend:** `frontend/` (and `backend/staff/*`, which the server streams from disk) would be served as static files or included in the function bundle; the `express.static` setup would change.
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

## 6. Recommended order of work for guide Prompts 36-37

1. Decide with the owner whether a public site is wanted at all, or if a local/classroom demo is enough (if so, stop here).
2. Keep the live build in demo mode (`ORDERS_ENABLED` unset); run the real-Gemini checklist on the owner's laptop first.
3. Replace `data/orders.json` and in-memory sessions with a real database (this is the V2 work that unlocks ordering).
4. Adapt the Express app for Vercel (handler export, static files, config) and test a preview deployment.
5. Protect `/staff` (correct proxy setting, provider protection, strong password) and add a per-visitor rate limit to the chat.
6. Only then consider switching ordering on, as a separate decision by the owner.
