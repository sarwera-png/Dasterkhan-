# Karachi Dastarkhwan

Restaurant web app with an AI assistant, **Dastarkhwan Assistant**.

This is a **classroom training demo for a FICTIONAL restaurant** (Karachi Dastarkhwan, Gulshan-e-Iqbal, Karachi). Menu, prices, hours and promotions are placeholders, not a real business.

## What it does

- English + Urdu landing page with a floating chat widget.
- The assistant (Google Gemini) talks to the customer and calls tools. **Code, not the AI,** does all prices, totals, discounts, validation, confirmation and order saving.
- Order flow: menu -> cart -> pickup or delivery details -> review -> the customer presses the **Confirm order** button -> the order is saved to `data/orders.json` with an ID like `KD-1001`.
- Staff dashboard at `/staff` to move orders `NEW -> PREPARING -> READY -> COMPLETED` (forward only).

## Structure

- `frontend/` - `index.html`, `styles.css`, `app.js` (website and chat widget)
- `backend/` - Express server: chat route and model-fallback chain, tools, pricing, order review, order storage, staff dashboard
- `data/` - `menu.json`, `promotions.json`, `restaurant.json`, `recommendations.json` (business facts live here), and `orders.json` (local, git-ignored)
- `prompts/system-prompt.md` - the assistant's instructions

## Run locally

1. Install Node.js 20 or newer, then in this folder run `npm install`.
2. Copy `.env.example` to `.env` and fill in your own values (never commit `.env`):
   - `GEMINI_API_KEY` - your Google Gemini API key (free tier is rate limited)
   - `STAFF_PASSWORD` - a long, hard-to-guess password for the staff dashboard
   - `ORDERS_ENABLED` - set it to exactly `true` in your own `.env` to test placing orders locally (see "Ordering switch" below)
   - `PORT`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` - optional (defaults are in `.env.example`)
3. Start the server: `npm start`
4. Open <http://localhost:3000> for the website and chat, and <http://localhost:3000/staff> for the staff dashboard (the browser asks for a password: use any user name and your `STAFF_PASSWORD`).

Without `GEMINI_API_KEY` the chat answers with a safe "please contact staff" message. **Without `STAFF_PASSWORD` the staff dashboard is locked completely (HTTP 403)**: it never opens unprotected.

## Ordering switch (ORDERS_ENABLED)

Ordering is **off by default** (fail closed). Orders can be placed only when `ORDERS_ENABLED` is exactly `true`; unset, empty, `false`, `TRUE`, `1` or anything else means demo mode.

- **Off (demo mode):** the menu, chat, cart, totals and order review all still work, but there is no "Confirm order" button, `POST /api/order/confirm` answers `503 ordering_disabled` and writes nothing to `orders.json`, and the assistant tells the customer that this is a demo and orders cannot be placed right now. The staff dashboard is unaffected.
- **On:** the normal flow (review, Confirm order button, saved `KD-####` order). To test locally, put `ORDERS_ENABLED=true` in your own `.env` (never commit it) and restart the server.

## Orders storage (dev only) - IMPORTANT

`data/orders.json` is simple local storage for development and classroom practice. It starts as an empty JSON array (`[]`); if the file is missing it is created on the first confirmed order.

- It is **dev-only and not for production**: no database, no backups, no locking between several server processes, and customer details (name, phone, address) are stored in plain text.
- It is **ignored by Git** (see `.gitignore`), so orders and customer details are never committed. Each machine keeps its own copy.
- Orders are written safely (temporary file, then rename), and only *confirmed* orders are ever saved, never drafts.

### Live order submission must stay disabled until durable storage exists

Serverless hosts such as **Vercel do not guarantee that files written at runtime are kept** (writes can be lost, differ between instances, or be refused). Orders saved there could silently disappear while customers believe they were placed.

- Do **not** deploy this demo for real customers on a serverless host. Use it locally or on a single always-on server with a normal disk.
- Keep `ORDERS_ENABLED` unset on any public or serverless deployment until a real database replaces `data/orders.json` (planned V2 upgrade).
- Use HTTPS for any shared deployment (the staff password is sent with every request) and choose a strong `STAFF_PASSWORD`.

## Security notes

- Secrets live only in `.env` (git-ignored) or the host's environment settings. `.env.example` contains placeholder names only.
- The Gemini key never reaches the browser. The chat never logs API keys, passwords, customer messages or customer details.
- Customer text on the staff dashboard is shown as plain text (never as HTML).
