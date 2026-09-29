// Practice mock chat widget: no API, no network calls, no storage.
(function () {
  var REPLY = "Hi! I'm Dastarkhwan Assistant. My AI brain isn't connected yet.";

  var toggle = document.getElementById('chat-toggle');
  var win = document.getElementById('chat-window');
  var closeBtn = document.getElementById('chat-close');
  var messages = document.getElementById('chat-messages');
  var form = document.getElementById('chat-form');
  var input = document.getElementById('chat-input');

  function setOpen(open) {
    win.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      input.focus();
    } else {
      toggle.focus();
    }
  }

  function addMessage(text, who) {
    var bubble = document.createElement('div');
    bubble.className = 'chat-msg chat-msg-' + who;
    bubble.setAttribute('dir', 'auto');
    bubble.textContent = text;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
  }

  toggle.addEventListener('click', function () {
    setOpen(!win.classList.contains('open'));
  });

  closeBtn.addEventListener('click', function () {
    setOpen(false);
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text) {
      return;
    }
    addMessage(text, 'user');
    input.value = '';
    addMessage(REPLY, 'bot');
  });
})();
