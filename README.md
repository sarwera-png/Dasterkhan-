# Karachi Dastarkhwan

Restaurant web app with an AI assistant, **Dastarkhwan Assistant**.

## Structure

- `frontend/` - index.html, styles.css, app.js
- `backend/` - server code
- `data/` - menu and restaurant data
- `prompts/` - assistant prompts

## Orders storage (dev only)

`data/orders.json` is simple local storage for development and classroom practice. It starts as an empty JSON array (`[]`).

- It is **dev-only and not for production**: no database, no locking, no backups, and no protection for customer details.
- It is **ignored by Git** (see `.gitignore`), so orders and customer details are never committed. Each machine keeps its own copy.
- If the file is missing, create it with the content `[]`.
