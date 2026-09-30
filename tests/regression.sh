#!/bin/bash
# Basic server regression (no Gemini key, so the chat must answer with the safe fallback). Uses port $REG_PORT (default 3012).
cd "$(dirname "$0")/.." || exit 1
PORT_N=${REG_PORT:-3012}; LOG=$(mktemp); H='Content-Type: application/json'; FAIL=0
ok() { echo "  PASS: $1"; }; bad() { echo "  FAIL: $1"; FAIL=1; }
for f in backend/*.js frontend/app.js; do node --check "$f" || bad "syntax $f"; done; ok "node --check on all js files"
env -u GEMINI_API_KEY PORT=$PORT_N node backend/server.js > "$LOG" 2>&1 & PID=$!
sleep 2
grep -q "Server running on http://localhost:$PORT_N" "$LOG" && ok "server starts" || bad "server start"
c() { curl -s -o /dev/null -w '%{http_code}' -X POST localhost:$PORT_N/api/chat -H "$H" --data-binary "$1"; }
[ "$(c '{"message":"hi"}')" = 503 ] && ok "no key -> safe 503 fallback" || bad "no-key fallback"
[ "$(c '{"message":"   "}')" = 400 ] && ok "empty message -> 400" || bad "empty"
[ "$(c '{"conversationHistory":[]}')" = 400 ] && ok "missing message -> 400" || bad "missing"
[ "$(c '{"message":"hi","conversationHistory":"x"}')" = 400 ] && ok "history not array -> 400" || bad "history type"
id1=$(curl -s -X POST localhost:$PORT_N/api/chat -H "$H" -d '{"message":"hi"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).sessionId'); id2=$(curl -s -X POST localhost:$PORT_N/api/chat -H "$H" -d '{"message":"hi"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).sessionId')
[ -n "$id1" ] && [ "$id1" != "$id2" ] && ok "two sessions get different ids" || bad "session ids"
for u in / /styles.css /app.js; do [ "$(curl -s -o /dev/null -w '%{http_code}' localhost:$PORT_N$u)" = 200 ] || bad "static $u"; done; ok "static files 200"
kill $PID 2>/dev/null; wait $PID 2>/dev/null; rm -f "$LOG"
[ "$FAIL" = 0 ] && echo "REGRESSION: ALL PASS" || echo "REGRESSION: FAILURES"
[ "$FAIL" = 0 ]
