/* CVMILOPORRAS_SERVER */
/* HVX store: customer accounts, cart and checkout.

   Self-contained and additive. It renders its own UI into the page, so the
   only markup the rest of the site needs is a button carrying
   data-hvx-add="<product id>" - clicks are picked up by delegation here.

   Public surface (window.HVXShop):
     isAuthed()            true when a customer session is active
     currentUser()         the signed-in customer, or null
     openAuth(message)     opens the sign in / register panel
     addToCart(id)         adds a catalog product to the cart
     openCart()            opens the cart drawer
     refresh()             re-reads the catalog and repaints the cart */

(function () {
  'use strict';

  var API_AUTH = '/api/auth';
  var API_ORDERS = '/api/orders';
  var API_STRIPE = '/api/payments/stripe';

  var TOKEN_KEY = 'hvx_user_token';
  var CART_KEY = 'hvx_cart';
  var CATALOG_KEY = 'hvx_merch';

  var state = { user: null, cart: [], busy: false };
  var ui = {};

  /* ------------------------------------------------------------------ util */

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed || fallback;
    } catch (e) { return fallback; }
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(value) {
    var n = Number(String(value).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function fmt(value) {
    return '$' + money(value).toFixed(2);
  }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function setToken(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* storage disabled */ }
  }

  function api(url, options) {
    var opts = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (opts.auth !== false && token()) headers.Authorization = 'Bearer ' + token();
    return fetch(url, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  /* --------------------------------------------------------------- catalog */

  function catalog() {
    var list = readJSON(CATALOG_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function findProduct(id) {
    var list = catalog();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function isPurchasable(product) {
    var status = (product && product.status) || 'available';
    return status === 'available' || status === 'preorder';
  }

  /* ------------------------------------------------------------------ cart */

  function loadCart() {
    var raw = readJSON(CART_KEY, []);
    var lines = Array.isArray(raw) ? raw : [];
    state.cart = lines.filter(function (line) {
      return line && line.id && findProduct(line.id);
    });
    /* Products the admin pulled from the catalog are dropped from storage too,
       so a later product reusing the same id cannot resurrect a stale line. */
    if (state.cart.length !== lines.length) {
      try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch (e) { /* ignore */ }
    }
  }

  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch (e) { /* ignore */ }
    paintNav();
  }

  function cartCount() {
    return state.cart.reduce(function (sum, line) { return sum + line.qty; }, 0);
  }

  function cartTotal() {
    return state.cart.reduce(function (sum, line) {
      var product = findProduct(line.id);
      return sum + (product ? money(product.price) * line.qty : 0);
    }, 0);
  }

  function addToCart(id) {
    var product = findProduct(id);
    if (!product) return false;
    if (!isPurchasable(product)) return false;

    var existing = null;
    for (var i = 0; i < state.cart.length; i++) {
      if (state.cart[i].id === id) { existing = state.cart[i]; break; }
    }
    if (existing) existing.qty = Math.min(20, existing.qty + 1);
    else state.cart.push({ id: id, qty: 1 });

    saveCart();
    paintCart();
    openCart();
    return true;
  }

  function setQty(id, delta) {
    for (var i = 0; i < state.cart.length; i++) {
      if (state.cart[i].id !== id) continue;
      state.cart[i].qty = state.cart[i].qty + delta;
      if (state.cart[i].qty < 1) state.cart.splice(i, 1);
      else if (state.cart[i].qty > 20) state.cart[i].qty = 20;
      break;
    }
    saveCart();
    paintCart();
  }

  function removeLine(id) {
    state.cart = state.cart.filter(function (line) { return line.id !== id; });
    saveCart();
    paintCart();
  }

  function clearCart() {
    state.cart = [];
    saveCart();
    paintCart();
  }

  /* -------------------------------------------------------------- ui build */

  function buildUI() {
    var overlay = document.createElement('div');
    overlay.className = 'hvx-overlay';
    overlay.id = 'hvx-auth-overlay';
    overlay.innerHTML =
      '<div class="hvx-panel" role="dialog" aria-modal="true" aria-labelledby="hvx-auth-title">' +
        '<div class="hvx-panel-head">' +
          '<div>' +
            '<p class="hvx-panel-title" id="hvx-auth-title">HVX Account</p>' +
            '<p class="hvx-panel-sub" id="hvx-auth-sub">Sign in or create an account to shop the store.</p>' +
          '</div>' +
          '<button class="hvx-close" id="hvx-auth-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div id="hvx-auth-body"></div>' +
      '</div>';

    var drawer = document.createElement('div');
    drawer.className = 'hvx-drawer-wrap';
    drawer.id = 'hvx-cart-wrap';
    drawer.innerHTML =
      '<div class="hvx-drawer-scrim" id="hvx-cart-scrim"></div>' +
      '<aside class="hvx-drawer" role="dialog" aria-modal="true" aria-label="Shopping cart">' +
        '<div class="hvx-drawer-head">' +
          '<p class="hvx-drawer-title">Your Cart</p>' +
          '<button class="hvx-close" id="hvx-cart-close" aria-label="Close cart">&times;</button>' +
        '</div>' +
        '<div class="hvx-drawer-body" id="hvx-cart-body"></div>' +
        '<div class="hvx-drawer-foot" id="hvx-cart-foot"></div>' +
      '</aside>';

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    ui.overlay = overlay;
    ui.authBody = document.getElementById('hvx-auth-body');
    ui.authSub = document.getElementById('hvx-auth-sub');
    ui.drawer = drawer;
    ui.cartBody = document.getElementById('hvx-cart-body');
    ui.cartFoot = document.getElementById('hvx-cart-foot');

    document.getElementById('hvx-auth-close').addEventListener('click', closeAuth);
    document.getElementById('hvx-cart-close').addEventListener('click', closeCart);
    document.getElementById('hvx-cart-scrim').addEventListener('click', closeCart);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay && !overlay.dataset.locked) closeAuth();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!ui.overlay.dataset.locked) closeAuth();
      closeCart();
    });

    buildNav();
  }

  function buildNav() {
    var host = document.querySelector('.nav-cta');
    if (!host || document.getElementById('hvx-nav-actions')) return;

    var wrap = document.createElement('div');
    wrap.className = 'hvx-nav-actions';
    wrap.id = 'hvx-nav-actions';
    wrap.innerHTML =
      '<button class="hvx-icon-btn" id="hvx-account-btn">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
        '<span id="hvx-account-label">Sign In</span>' +
      '</button>' +
      '<button class="hvx-icon-btn" id="hvx-cart-btn" aria-label="Open cart">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>' +
        '<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>' +
        '<span class="hvx-cart-count" id="hvx-cart-count">0</span>' +
      '</button>';

    host.appendChild(wrap);
    document.getElementById('hvx-account-btn').addEventListener('click', function () { openAuth(); });
    document.getElementById('hvx-cart-btn').addEventListener('click', openCart);
  }

  /* ---------------------------------------------------------------- paints */

  function paintNav() {
    var label = document.getElementById('hvx-account-label');
    if (label) label.textContent = state.user ? state.user.firstName : 'Sign In';

    var badge = document.getElementById('hvx-cart-count');
    if (badge) {
      var n = cartCount();
      badge.textContent = String(n);
      badge.classList.toggle('visible', n > 0);
    }
  }

  function paintAuth() {
    if (state.user) { paintAccount(); return; }

    ui.authBody.innerHTML =
      '<div class="hvx-tabs">' +
        '<button class="hvx-tab active" data-hvx-tab="login">Sign In</button>' +
        '<button class="hvx-tab" data-hvx-tab="register">Register</button>' +
      '</div>' +
      '<div class="hvx-msg" id="hvx-auth-msg"></div>' +

      '<form class="hvx-form" id="hvx-form-login" novalidate>' +
        '<div class="hvx-field">' +
          '<label class="hvx-label" for="hvx-login-email">Email</label>' +
          '<input class="hvx-input" type="email" id="hvx-login-email" autocomplete="email" required/>' +
        '</div>' +
        '<div class="hvx-field">' +
          '<label class="hvx-label" for="hvx-login-pass">Password</label>' +
          '<input class="hvx-input" type="password" id="hvx-login-pass" autocomplete="current-password" required/>' +
        '</div>' +
        '<button class="hvx-btn" type="submit">Sign In</button>' +
      '</form>' +

      '<form class="hvx-form hidden" id="hvx-form-register" novalidate>' +
        '<div class="hvx-row">' +
          '<div class="hvx-field">' +
            '<label class="hvx-label" for="hvx-reg-first">First Name</label>' +
            '<input class="hvx-input" type="text" id="hvx-reg-first" autocomplete="given-name" required/>' +
          '</div>' +
          '<div class="hvx-field">' +
            '<label class="hvx-label" for="hvx-reg-last">Last Name</label>' +
            '<input class="hvx-input" type="text" id="hvx-reg-last" autocomplete="family-name" required/>' +
          '</div>' +
        '</div>' +
        '<div class="hvx-field">' +
          '<label class="hvx-label" for="hvx-reg-email">Email</label>' +
          '<input class="hvx-input" type="email" id="hvx-reg-email" autocomplete="email" required/>' +
        '</div>' +
        '<div class="hvx-field">' +
          '<label class="hvx-label" for="hvx-reg-pass">Password</label>' +
          '<input class="hvx-input" type="password" id="hvx-reg-pass" autocomplete="new-password" required/>' +
          '<p class="hvx-hint">At least 8 characters.</p>' +
        '</div>' +
        '<button class="hvx-btn" type="submit">Create Account</button>' +
      '</form>';

    Array.prototype.forEach.call(ui.authBody.querySelectorAll('[data-hvx-tab]'), function (tab) {
      tab.addEventListener('click', function () { showTab(tab.dataset.hvxTab); });
    });
    document.getElementById('hvx-form-login').addEventListener('submit', doLogin);
    document.getElementById('hvx-form-register').addEventListener('submit', doRegister);
  }

  function showTab(name) {
    Array.prototype.forEach.call(ui.authBody.querySelectorAll('[data-hvx-tab]'), function (tab) {
      tab.classList.toggle('active', tab.dataset.hvxTab === name);
    });
    var login = document.getElementById('hvx-form-login');
    var register = document.getElementById('hvx-form-register');
    if (login) login.classList.toggle('hidden', name !== 'login');
    if (register) register.classList.toggle('hidden', name !== 'register');
    message('');
  }

  function paintAccount() {
    ui.authSub.textContent = 'You are signed in.';
    ui.authBody.innerHTML =
      '<p class="hvx-account-name">' + esc(state.user.firstName + ' ' + state.user.lastName) + '</p>' +
      '<p class="hvx-account-email">' + esc(state.user.email) + '</p>' +
      '<div class="hvx-msg" id="hvx-auth-msg"></div>' +
      '<p class="hvx-label">Recent Orders</p>' +
      '<div class="hvx-order-list" id="hvx-orders"><p class="hvx-hint">Loading...</p></div>' +
      '<button class="hvx-btn hvx-btn-ghost" id="hvx-logout">Sign Out</button>';

    document.getElementById('hvx-logout').addEventListener('click', doLogout);
    loadOrders();
  }

  function loadOrders() {
    api(API_ORDERS + '?mine=1').then(function (res) {
      var host = document.getElementById('hvx-orders');
      if (!host) return;
      var orders = Array.isArray(res.data) ? res.data : [];
      if (!res.ok || !orders.length) {
        host.innerHTML = '<p class="hvx-hint">No orders yet.</p>';
        return;
      }
      host.innerHTML = orders.slice(0, 10).map(function (o) {
        var when = new Date(o.createdAt).toLocaleDateString('en-GB',
          { day: '2-digit', month: 'short', year: 'numeric' });
        var status = (o.payment && o.payment.status === 'paid') ? 'Paid' : 'Pending payment';
        return '<div class="hvx-order">' +
          '<div><div class="hvx-order-ref">' + esc(o.reference) + '</div>' +
          '<div class="hvx-order-meta">' + when + ' &middot; ' + esc(status) + '</div></div>' +
          '<div class="hvx-order-total">' + fmt(o.total) + '</div></div>';
      }).join('');
    });
  }

  function paintCart() {
    if (!ui.cartBody) return;

    if (!state.cart.length) {
      ui.cartBody.innerHTML = '<div class="hvx-empty">Your cart is empty.</div>';
      ui.cartFoot.innerHTML = '';
      return;
    }

    ui.cartBody.innerHTML = state.cart.map(function (line) {
      var p = findProduct(line.id);
      if (!p) return '';
      var preorder = (p.status || '') === 'preorder';
      return '<div class="hvx-line">' +
        '<div class="hvx-line-img">' +
          (p.img ? '<img src="' + esc(p.img) + '" alt="' + esc(p.name) + '">' : '&#9834;') +
        '</div>' +
        '<div>' +
          '<div class="hvx-line-name">' + esc(p.name) + '</div>' +
          '<div class="hvx-line-price">' + fmt(p.price) + '</div>' +
          (preorder ? '<span class="hvx-line-tag">Pre-order</span>' : '') +
          '<div class="hvx-qty">' +
            '<button class="hvx-qty-btn" data-hvx-qty="-1" data-hvx-id="' + esc(line.id) + '" aria-label="Decrease">-</button>' +
            '<span class="hvx-qty-val">' + line.qty + '</span>' +
            '<button class="hvx-qty-btn" data-hvx-qty="1" data-hvx-id="' + esc(line.id) + '" aria-label="Increase">+</button>' +
          '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div class="hvx-line-price">' + fmt(money(p.price) * line.qty) + '</div>' +
          '<button class="hvx-line-remove" data-hvx-remove="' + esc(line.id) + '">Remove</button>' +
        '</div>' +
      '</div>';
    }).join('');

    var hasPreorder = state.cart.some(function (line) {
      var p = findProduct(line.id);
      return p && p.status === 'preorder';
    });

    ui.cartFoot.innerHTML =
      '<div class="hvx-msg" id="hvx-cart-msg"></div>' +
      '<div class="hvx-totals"><span>Total</span><strong>' + fmt(cartTotal()) + '</strong></div>' +
      '<button class="hvx-btn" id="hvx-checkout">' +
        (state.user ? 'Checkout' : 'Sign In to Checkout') +
      '</button>' +
      (hasPreorder
        ? '<p class="hvx-foot-note">Pre-order items ship when the drop is released.</p>'
        : '');

    document.getElementById('hvx-checkout').addEventListener('click', doCheckout);
  }

  /* ----------------------------------------------------------- open/close */

  function openAuth(note, locked) {
    paintAuth();
    if (note) {
      ui.authSub.textContent = note;
    } else if (!state.user) {
      ui.authSub.textContent = 'Sign in or create an account to shop the store.';
    }
    if (locked) ui.overlay.dataset.locked = '1';
    else delete ui.overlay.dataset.locked;

    ui.overlay.classList.add('open');
    var close = document.getElementById('hvx-auth-close');
    if (close) close.style.display = locked ? 'none' : '';

    var first = ui.overlay.querySelector('input');
    if (first) setTimeout(function () { first.focus(); }, 120);
  }

  function closeAuth() {
    if (ui.overlay.dataset.locked) return;
    ui.overlay.classList.remove('open');
  }

  function openCart() {
    paintCart();
    ui.drawer.classList.add('open');
  }

  function closeCart() {
    ui.drawer.classList.remove('open');
  }

  function message(text, kind, hostId) {
    var box = document.getElementById(hostId || 'hvx-auth-msg');
    if (!box) return;
    box.textContent = text || '';
    box.className = 'hvx-msg' + (text ? ' show ' + (kind || 'error') : '');
  }

  /* ------------------------------------------------------------ auth flows */

  function busy(button, on, idleLabel) {
    state.busy = on;
    if (!button) return;
    button.disabled = on;
    button.textContent = on ? 'Please wait...' : idleLabel;
  }

  function doLogin(event) {
    event.preventDefault();
    if (state.busy) return;
    var button = event.target.querySelector('button[type="submit"]');
    var email = document.getElementById('hvx-login-email').value.trim();
    var password = document.getElementById('hvx-login-pass').value;

    if (!email || !password) { message('Enter your email and password.'); return; }

    busy(button, true, 'Sign In');
    api(API_AUTH + '?action=login', { method: 'POST', auth: false, body: { email: email, password: password } })
      .then(function (res) {
        busy(button, false, 'Sign In');
        if (!res.ok) { message(res.data.error || 'Could not sign in.'); return; }
        setToken(res.data.token);
        state.user = res.data.user;
        paintNav();
        paintAuth();
        paintCart();
        message('Signed in.', 'ok');
        setTimeout(closeAuth, 700);
      })
      .catch(function () {
        busy(button, false, 'Sign In');
        message('Network error. Please try again.');
      });
  }

  function doRegister(event) {
    event.preventDefault();
    if (state.busy) return;
    var button = event.target.querySelector('button[type="submit"]');
    var payload = {
      firstName: document.getElementById('hvx-reg-first').value.trim(),
      lastName: document.getElementById('hvx-reg-last').value.trim(),
      email: document.getElementById('hvx-reg-email').value.trim(),
      password: document.getElementById('hvx-reg-pass').value
    };

    if (!payload.firstName) { message('First name is required.'); return; }
    if (!payload.lastName) { message('Last name is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) { message('Enter a valid email address.'); return; }
    if (payload.password.length < 8) { message('Password must be at least 8 characters.'); return; }

    busy(button, true, 'Create Account');
    api(API_AUTH + '?action=register', { method: 'POST', auth: false, body: payload })
      .then(function (res) {
        busy(button, false, 'Create Account');
        if (!res.ok) { message(res.data.error || 'Could not create the account.'); return; }
        setToken(res.data.token);
        state.user = res.data.user;
        paintNav();
        paintAuth();
        paintCart();
        message('Welcome to HVX.', 'ok');
        setTimeout(closeAuth, 900);
      })
      .catch(function () {
        busy(button, false, 'Create Account');
        message('Network error. Please try again.');
      });
  }

  function doLogout() {
    api(API_AUTH + '?action=logout', { method: 'POST' }).catch(function () { /* ignore */ });
    setToken('');
    state.user = null;
    paintNav();
    paintAuth();
    paintCart();
    ui.authSub.textContent = 'Sign in or create an account to shop the store.';
  }

  function loadSession() {
    if (!token()) return Promise.resolve();
    return api(API_AUTH + '?action=me').then(function (res) {
      if (res.ok && res.data.user) state.user = res.data.user;
      else setToken('');
      paintNav();
    }).catch(function () { /* offline: stay signed out */ });
  }

  /* --------------------------------------------------------------- checkout */

  function doCheckout() {
    if (state.busy) return;

    if (!state.user) {
      closeCart();
      openAuth('Sign in or create an account to complete your order.');
      return;
    }
    if (!state.cart.length) return;

    var button = document.getElementById('hvx-checkout');
    busy(button, true, 'Checkout');
    message('', '', 'hvx-cart-msg');

    var items = state.cart.map(function (line) { return { id: line.id, qty: line.qty }; });

    api(API_ORDERS, { method: 'POST', body: { items: items } })
      .then(function (res) {
        if (!res.ok) {
          busy(button, false, 'Checkout');
          if (res.status === 401) {
            setToken('');
            state.user = null;
            paintNav();
            closeCart();
            openAuth('Your session expired. Please sign in again.');
            return null;
          }
          message(res.data.error || 'Could not place the order.', 'error', 'hvx-cart-msg');
          return null;
        }
        return res.data.order;
      })
      .then(function (order) {
        if (!order) return;
        return api(API_STRIPE + '?action=create-checkout-session', {
          method: 'POST',
          body: { reference: order.reference }
        }).then(function (res) {
          busy(button, false, 'Checkout');

          if (res.ok && res.data.url) {
            /* Stripe hosts the payment page; card details never touch this site. */
            clearCart();
            window.location.href = res.data.url;
            return;
          }

          if (res.status === 501) {
            /* Payments not switched on yet: the order is saved, say so plainly. */
            clearCart();
            message('Order ' + order.reference + ' received. Online payment is not '
              + 'enabled yet, so we will contact you at ' + state.user.email
              + ' to arrange it.', 'info', 'hvx-cart-msg');
            return;
          }

          message(res.data.error || 'Could not start checkout.', 'error', 'hvx-cart-msg');
        });
      })
      .catch(function () {
        busy(button, false, 'Checkout');
        message('Network error. Please try again.', 'error', 'hvx-cart-msg');
      });
  }

  /* Shows the outcome when Stripe sends the customer back. */
  function handleReturn() {
    var params = new URLSearchParams(window.location.search);
    var ref = params.get('order');
    if (!ref) return;

    if (params.get('paid')) {
      clearCart();
      openAuth('Payment received. Order ' + ref + ' is confirmed - thank you.');
    } else if (params.get('canceled')) {
      openCart();
      message('Checkout canceled. Order ' + ref + ' is still awaiting payment.',
        'info', 'hvx-cart-msg');
    }

    if (window.history.replaceState) {
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    }
  }

  /* ------------------------------------------------------------ delegation */

  document.addEventListener('click', function (event) {
    var add = event.target.closest('[data-hvx-add]');
    if (add) {
      event.preventDefault();
      addToCart(add.getAttribute('data-hvx-add'));
      return;
    }
    var qty = event.target.closest('[data-hvx-qty]');
    if (qty) {
      setQty(qty.getAttribute('data-hvx-id'), parseInt(qty.getAttribute('data-hvx-qty'), 10));
      return;
    }
    var remove = event.target.closest('[data-hvx-remove]');
    if (remove) {
      removeLine(remove.getAttribute('data-hvx-remove'));
    }
  });

  /* ------------------------------------------------------------------ init */

  function start() {
    buildUI();
    loadCart();
    paintNav();
    paintCart();

    loadSession().then(function () {
      paintCart();

      var cfg = window.HVX_CONFIG && window.HVX_CONFIG.shop;
      if (cfg && cfg.requireAuthOnEntry && !state.user) {
        openAuth('Sign in or create an account to continue.', true);
      }
      handleReturn();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.HVXShop = {
    isAuthed: function () { return Boolean(state.user); },
    currentUser: function () { return state.user; },
    openAuth: openAuth,
    addToCart: addToCart,
    openCart: openCart,
    refresh: function () { loadCart(); paintCart(); paintNav(); }
  };
})();
