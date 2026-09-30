// Staff dashboard. All customer text is put on the page with textContent only (never as HTML).
(function () {
  var ordersEl = document.getElementById('orders');
  var messageEl = document.getElementById('message');
  var updatedEl = document.getElementById('updated');
  var refreshBtn = document.getElementById('refresh');
  var flow = ['NEW', 'PREPARING', 'READY', 'COMPLETED'];

  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function optionsText(options) {
    var parts = Object.keys(options || {}).map(function (k) { return k + ': ' + options[k]; });
    return parts.length ? ' (' + parts.join(', ') + ')' : '';
  }

  function renderOrder(order) {
    var review = order.review || {};
    var card = el('article', null, 'order');
    card.setAttribute('data-id', order.id);

    var title = el('h2');
    title.appendChild(el('span', order.id));
    title.appendChild(el('span', order.status, 'status'));
    card.appendChild(title);
    card.appendChild(el('p', new Date(order.createdAt).toLocaleString(), 'meta'));

    var list = el('ul');
    (review.items || []).forEach(function (item) {
      list.appendChild(el('li', item.quantity + ' x ' + item.name + optionsText(item.options)));
    });
    card.appendChild(list);

    var customer = review.customer || {};
    card.appendChild(el('p', (review.orderType === 'delivery' ? 'Delivery' : 'Pickup') + ' - ' + (customer.name || '')));
    if (review.orderType === 'delivery' && review.delivery) {
      var a = review.delivery.address || {};
      card.appendChild(el('p', 'Phone: ' + (customer.phone || '')));
      card.appendChild(el('p', 'Address: House or flat ' + a.house + ', ' + a.street + ', Block ' + a.block + (a.apartment ? ', apartment ' + a.apartment : '')));
      if (a.instructions) card.appendChild(el('p', 'Instructions: ' + a.instructions));
    } else if (review.pickup && review.pickup.time) {
      card.appendChild(el('p', 'Preferred pickup time: ' + review.pickup.time));
    }
    var totals = review.totals || {};
    card.appendChild(el('p', 'Total: ' + totals.total + ' PKR (cash on ' + (review.orderType === 'delivery' ? 'delivery' : 'pickup') + ')', 'total'));

    var next = flow[flow.indexOf(order.status) + 1];
    if (next) {
      var btn = el('button', 'Mark ' + next);
      btn.type = 'button';
      btn.addEventListener('click', function () { advance(order.id, next, btn); });
      card.appendChild(btn);
    }
    return card;
  }

  function render(orders) {
    ordersEl.textContent = '';
    if (!orders.length) {
      ordersEl.appendChild(el('p', 'No orders yet.'));
      return;
    }
    orders.forEach(function (order) { ordersEl.appendChild(renderOrder(order)); });
  }

  function load() {
    return fetch('/api/staff/orders', { cache: 'no-store', credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        return res.json();
      })
      .then(function (data) {
        render(data.orders || []);
        messageEl.textContent = '';
        updatedEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
      })
      .catch(function () {
        messageEl.textContent = 'Could not load orders.';
      });
  }

  function advance(id, status, btn) {
    btn.disabled = true;
    fetch('/api/staff/orders/' + encodeURIComponent(id) + '/status', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: status })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          messageEl.textContent = res.ok ? id + ' is now ' + status + '.' : (data && data.error) || 'Could not change the status.';
        });
      })
      .catch(function () {
        messageEl.textContent = 'Could not change the status.';
      })
      .then(load);
  }

  refreshBtn.addEventListener('click', load);
  load();
  setInterval(load, 15000);
})();
