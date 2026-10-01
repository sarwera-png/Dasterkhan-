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
  var confirmBox = document.getElementById('chat-confirm');
  var confirmBtn = document.getElementById('chat-confirm-btn');

  var history = []; // [{ role: 'user' | 'assistant', content: '...' }]
  var sessionId = null; // chat session id from the server, kept in memory only
  var sessionToken = null; // sealed order state from the server (encrypted, we cannot read or change it); sent back with every request, kept in memory only
  var reviewVersion = null; // set by the server only while an order review is shown and still valid
  var busy = false;
  var confirming = false;

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
      bubble.setAttribute('lang', 'ur'); // picks up the Urdu font stack
    }
    // One block per line, so each line gets its own direction and line height: only lines that contain Urdu
    // need the tall Nastaliq spacing, English lines inside the same bubble stay tight. Plain text only, never innerHTML.
    // The newline characters are kept between the blocks, so the bubble's textContent is exactly the original text.
    text.split('\n').forEach(function (line, index) {
      if (index > 0) {
        bubble.appendChild(document.createTextNode('\n'));
      }
      var row = document.createElement('div');
      row.className = line === '' ? 'chat-line chat-line-blank' : 'chat-line';
      row.setAttribute('dir', 'auto');
      if (URDU_SCRIPT.test(line)) {
        row.setAttribute('lang', 'ur');
      }
      row.textContent = line;
      bubble.appendChild(row);
    });
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

  // The "Confirm order" button is shown only while the server says the review the customer saw is still valid.
  function updateConfirmButton() {
    var show = !!reviewVersion && !busy && !confirming;
    confirmBox.hidden = !show;
  }

  function setBusy(value) {
    busy = value;
    input.disabled = value;
    sendBtn.disabled = value;
    updateConfirmButton();
  }

  // Returns { ok, reply }. Never throws and never exposes raw error details.
  function askServer(message) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    return fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message, conversationHistory: history.slice(-MAX_HISTORY), sessionId: sessionId, sessionToken: sessionToken }),
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
        if (data && typeof data.sessionId === 'string') {
          sessionId = data.sessionId;
        }
        if (data && typeof data.sessionToken === 'string') {
          sessionToken = data.sessionToken;
        }
        // Any reply without a valid review (or a failed request) hides the button: the old review no longer counts.
        reviewVersion = data && typeof data.reviewVersion === 'string' ? data.reviewVersion : null;
        if (data && typeof data.reply === 'string' && data.reply.trim() !== '') {
          return { ok: result.res.ok, reply: data.reply };
        }
        return { ok: false, reply: GENERIC_ERROR };
      })
      .catch(function () {
        reviewVersion = null;
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
      setBusy(false); // also shows or hides the Confirm button
      if (win.classList.contains('open')) {
        input.focus();
      }
    });
  });

  // Pressing the button is the only way to confirm an order. Typing in the chat never confirms anything.
  confirmBtn.addEventListener('click', function () {
    if (!reviewVersion || confirming || busy) {
      return;
    }
    confirming = true;
    confirmBtn.disabled = true;
    var versionToConfirm = reviewVersion;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 30000);

    fetch('/api/order/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, sessionToken: sessionToken, reviewVersion: versionToConfirm }),
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
        if (data && typeof data.sessionToken === 'string') {
          sessionToken = data.sessionToken; // the saved order is part of the session state now
        }
        var text = data && typeof data.customerMessage === 'string' && data.customerMessage.trim() !== '' ? data.customerMessage : GENERIC_ERROR;
        // The wording always comes from the server: it only talks about a saved order when it has a saved order number.
        addMessage(text, 'bot');
        reviewVersion = null; // the button disappears after an answer; a new review brings it back
      })
      .catch(function () {
        addMessage(GENERIC_ERROR, 'bot');
        reviewVersion = null;
      })
      .then(function () {
        clearTimeout(timer);
        confirming = false;
        confirmBtn.disabled = false;
        updateConfirmButton();
      });
  });
})();
