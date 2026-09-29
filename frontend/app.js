// Chat widget: talks to POST /api/chat. History lives in memory only (no storage, no cookies).
(function () {
  var GENERIC_ERROR = 'Sorry, something went wrong. Please try again or contact staff.';
  var MAX_HISTORY = 10;
  var TIMEOUT_MS = 90000; // the server may try several models, up to 20s each
  var URDU_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

  var toggle = document.getElementById('chat-toggle');
  var win = document.getElementById('chat-window');
  var closeBtn = document.getElementById('chat-close');
  var messages = document.getElementById('chat-messages');
  var form = document.getElementById('chat-form');
  var input = document.getElementById('chat-input');
  var sendBtn = form.querySelector('.chat-send');

  var history = []; // [{ role: 'user' | 'assistant', content: '...' }]
  var busy = false;

  function setOpen(open) {
    win.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      if (!busy) input.focus();
    } else {
      toggle.focus();
    }
  }

  function addMessage(text, who, extraClass) {
    var bubble = document.createElement('div');
    bubble.className = 'chat-msg chat-msg-' + who + (extraClass ? ' ' + extraClass : '');
    bubble.setAttribute('dir', 'auto');
    if (URDU_SCRIPT.test(text)) {
      bubble.setAttribute('lang', 'ur'); // picks up the Urdu font and line-height rules
    }
    bubble.textContent = text; // plain text only, never innerHTML
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  // Safety net for assistant replies only: drop bold markers (** and __) if the model uses them anyway.
  function stripMarkdownMarkers(text) {
    return text
      .replace(/\*\*|__/g, '')
      .replace(/\n[ \t]*(\n[ \t]*)+/g, '\n\n') // at most one blank line between lines
      .trim();
  }

  function setBusy(value) {
    busy = value;
    input.disabled = value;
    sendBtn.disabled = value;
  }

  // Returns { ok, reply }. Never throws and never exposes raw error details.
  function askServer(message) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    return fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message, conversationHistory: history.slice(-MAX_HISTORY) }),
      signal: controller.signal
    })
      .then(function (res) {
        return res.json().then(
          function (data) { return { res: res, data: data }; },
          function () { return { res: res, data: null }; }
        );
      })
      .then(function (result) {
        var data = result.data;
        if (data && typeof data.reply === 'string' && data.reply.trim() !== '') {
          return { ok: result.res.ok, reply: data.reply };
        }
        return { ok: false, reply: GENERIC_ERROR };
      })
      .catch(function () {
        return { ok: false, reply: GENERIC_ERROR };
      })
      .then(function (outcome) {
        clearTimeout(timer);
        return outcome;
      });
  }

  toggle.addEventListener('click', function () {
    setOpen(!win.classList.contains('open'));
  });

  closeBtn.addEventListener('click', function () {
    setOpen(false);
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy) {
      return;
    }
    var text = input.value.trim();
    if (!text) {
      return;
    }

    addMessage(text, 'user');
    input.value = '';
    setBusy(true);
    var typing = addMessage('typing...', 'bot', 'chat-typing');

    askServer(text).then(function (outcome) {
      typing.remove();
      var replyText = stripMarkdownMarkers(outcome.reply);
      addMessage(replyText, 'bot');
      if (outcome.ok) {
        history.push({ role: 'user', content: text });
        history.push({ role: 'assistant', content: replyText });
      }
      setBusy(false);
      if (win.classList.contains('open')) {
        input.focus();
      }
    });
  });
})();
