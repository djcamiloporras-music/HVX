/* CVMILOPORRAS_SERVER */
/* HVX home feed: highlights published from the admin panel, each with its
   own comment thread.

   Self-contained and additive, on the same pattern as hvx-shop.js: it
   renders its own UI into one mount point and exposes nothing the rest of
   the site has to know about. The only markup it needs is

     <section class="feed" id="highlights" hidden>...<div id="hvx-feed"></div>

   WHY THE SECTION STARTS HIDDEN
   The site already refuses to point at an empty section - the Demos entry
   in the nav stays hidden until hvx-config.js has a link. The same rule
   applies here: with no highlights published, the section and its nav entry
   stay out of the page entirely rather than showing an empty grid. Nothing
   appears on the home page until something is actually published.

   SIGN-IN IS BORROWED, NOT REBUILT
   Posting a comment needs a customer session, which the store already
   owns. This calls window.HVXShop.openAuth() and reads the same token.
   There is no second login here to keep in step with the first.

   UNTRUSTED TEXT
   Comment bodies and author names come from visitors. They are written
   with textContent, never interpolated into innerHTML, so a comment
   containing markup is displayed as the characters the author typed. The
   admin-authored fields are escaped instead, because they are built into
   template strings alongside markup. */

(function () {
  'use strict';

  var API_HIGHLIGHTS = '/api/data?key=highlights';
  var API_COMMENTS = '/api/comments';
  var TOKEN_KEY = 'hvx_user_token';

  /* Must match MAX_LENGTH in netlify/lib/moderation.mjs. The server is the
     one that decides; this only spares the visitor a round trip to be told
     what the counter could have told them while typing. */
  var MAX_COMMENT = 1200;

  var ALL = 'All';

  var state = {
    items: [],
    category: ALL,
    open: null,        /* the highlight whose dialog is open */
    lastFocus: null,   /* what to focus again once it closes */
    sending: false
  };

  var dialog = null;   /* built once, reused */

  /* ---------------- helpers ---------------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Same rule as script.js: only rewrite our own uploads, leave a pasted
     third-party link and any data URI exactly as they are. */
  function sized(src, width) {
    var s = String(src || '');
    if (s.indexOf('/api/media?') !== 0) return s;
    return '/.netlify/images?url=' + encodeURIComponent(s) + '&w=' + width + '&q=76';
  }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function authed() {
    if (window.HVXShop && typeof window.HVXShop.isAuthed === 'function') {
      return window.HVXShop.isAuthed();
    }
    return Boolean(token());
  }

  function askSignIn(note) {
    if (window.HVXShop && typeof window.HVXShop.openAuth === 'function') {
      window.HVXShop.openAuth(note);
    }
  }

  /* A post id becomes part of a blob key on the server, which accepts only
     this shape. An entry that cannot produce one is still displayed - it
     simply gets no comment thread instead of a broken one. */
  function postId(item) {
    var s = String(item && item.id != null ? item.id : '').trim();
    return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
  }

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function when(iso) {
    var t = Date.parse(iso);
    if (!t) return '';
    try {
      return new Date(t).toLocaleDateString('en-GB',
        { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return new Date(t).toISOString().slice(0, 10);
    }
  }

  /* ---------------- data ---------------- */

  function load() {
    return fetch(API_HIGHLIGHTS)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return Array.isArray(d) ? d : []; })
      .catch(function () { return []; });
  }

  function categories() {
    var seen = {};
    var out = [];
    state.items.forEach(function (h) {
      var c = String((h && h.category) || '').trim();
      if (c && !seen[c]) { seen[c] = true; out.push(c); }
    });
    out.sort();
    return out;
  }

  function visible() {
    if (state.category === ALL) return state.items;
    return state.items.filter(function (h) {
      return String((h && h.category) || '').trim() === state.category;
    });
  }

  /* ---------------- grid ---------------- */

  function cardHtml(h, index) {
    var title = String((h && h.title) || '').trim();
    var cap = String((h && h.caption) || '').trim();
    var art = String((h && h.artist) || '').trim();
    var cat = String((h && h.category) || '').trim();
    var src = String((h && h.source) || '').trim();
    var img = h && h.dataUrl
      ? '<img src="' + esc(sized(h.dataUrl, 700)) + '" alt="' + esc(title || cap || art) +
        '" loading="lazy" decoding="async" />'
      : '<span class="hvxf-noimg">No image</span>';

    return '' +
      '<button class="hvxf-card" type="button" data-hvxf-open="' + index + '">' +
        '<span class="hvxf-thumb">' + img +
          (cat ? '<span class="hvxf-cat">' + esc(cat) + '</span>' : '') +
          (src ? '<span class="hvxf-src">' + esc(src) + '</span>' : '') +
        '</span>' +
        '<span class="hvxf-body">' +
          '<span class="hvxf-meta">' +
            '<span class="hvxf-artist">' + esc(art || 'HVX') + '</span>' +
            '<span class="hvxf-date">' + esc(String((h && h.date) || '')) + '</span>' +
          '</span>' +
          (title ? '<span class="hvxf-title">' + esc(title) + '</span>' : '') +
          (cap ? '<span class="hvxf-cap">' + esc(cap) + '</span>' : '') +
          '<span class="hvxf-more">Read and comment</span>' +
        '</span>' +
      '</button>';
  }

  function render() {
    var root = document.getElementById('hvx-feed');
    if (!root) return;

    var cats = categories();
    var rows = visible();

    var chips = '';
    if (cats.length > 1) {
      chips = '<div class="hvxf-filter" role="group" aria-label="Filter highlights">' +
        [ALL].concat(cats).map(function (c) {
          return '<button class="hvxf-chip" type="button" data-hvxf-cat="' + esc(c) +
            '" aria-pressed="' + (state.category === c ? 'true' : 'false') + '">' +
            esc(c) + '</button>';
        }).join('') + '</div>';
    }

    var body = rows.length
      ? '<div class="hvxf-grid">' + rows.map(cardHtml).join('') + '</div>'
      : '<div class="hvxf-empty"><p class="hvxf-empty-label">Nothing here yet</p>' +
        '<p class="hvxf-empty-msg">No highlights in this category.</p></div>';

    root.innerHTML = chips + body;
  }

  /* ---------------- comment thread ---------------- */

  function threadBox() {
    return dialog ? dialog.querySelector('[data-hvxf-thread]') : null;
  }

  function note(kind, text) {
    var n = node('p', 'hvxf-note ' + (kind === 'ok' ? 'hvxf-ok' : 'hvxf-bad'), text);
    return n;
  }

  function paintComments(rows) {
    var box = threadBox();
    if (!box) return;
    box.innerHTML = '';

    var head = node('p', 'hvxf-chead',
      rows.length === 1 ? '1 comment' : rows.length + ' comments');
    box.appendChild(head);

    if (!rows.length) {
      box.appendChild(node('p', 'hvxf-cnone', 'No comments yet. Be the first.'));
    } else {
      var list = node('ul', 'hvxf-list');
      rows.forEach(function (c) {
        var li = node('li', 'hvxf-c');
        var who = node('span', 'hvxf-cwho');
        /* textContent, not innerHTML: this is what a visitor typed. */
        who.appendChild(node('span', 'hvxf-cname', String((c && c.name) || 'Guest')));
        who.appendChild(node('span', 'hvxf-cwhen', when(c && c.createdAt)));
        li.appendChild(who);
        li.appendChild(node('p', 'hvxf-ctext', String((c && c.text) || '')));
        list.appendChild(li);
      });
      box.appendChild(list);
    }

    box.appendChild(composer());
  }

  function composer() {
    var id = state.open ? postId(state.open) : null;
    if (!id) return node('p', 'hvxf-cnone', 'Comments are not available on this post.');

    if (!authed()) {
      var btn = node('button', 'hvxf-signin', 'Sign in to comment');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        askSignIn('Sign in to leave a comment.');
      });
      return btn;
    }

    var form = node('div', 'hvxf-form');
    var ta = node('textarea', 'hvxf-ta');
    ta.setAttribute('placeholder', 'Write a comment...');
    ta.setAttribute('aria-label', 'Write a comment');
    ta.setAttribute('maxlength', String(MAX_COMMENT));

    var row = node('div', 'hvxf-frow');
    var count = node('span', 'hvxf-count', '0/' + MAX_COMMENT);
    var send = node('button', 'hvxf-send', 'Post comment');
    send.type = 'button';

    ta.addEventListener('input', function () {
      count.textContent = ta.value.length + '/' + MAX_COMMENT;
      if (ta.value.length >= MAX_COMMENT) count.classList.add('hvxf-over');
      else count.classList.remove('hvxf-over');
    });

    send.addEventListener('click', function () { submit(ta, send); });

    row.appendChild(count);
    row.appendChild(send);
    form.appendChild(ta);
    form.appendChild(row);
    return form;
  }

  function loadComments() {
    var id = state.open ? postId(state.open) : null;
    var box = threadBox();
    if (!box) return;
    if (!id) { paintComments([]); return; }

    box.innerHTML = '';
    box.appendChild(node('p', 'hvxf-chead', 'Loading comments...'));

    fetch(API_COMMENTS + '?post=' + encodeURIComponent(id))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        /* Guard against a late response for a dialog that has since been
           closed or switched to another post. */
        if (!state.open || postId(state.open) !== id) return;
        paintComments((d && Array.isArray(d.comments)) ? d.comments : []);
      })
      .catch(function () {
        if (!state.open || postId(state.open) !== id) return;
        paintComments([]);
        var box2 = threadBox();
        if (box2) box2.appendChild(note('bad', 'Comments could not be loaded.'));
      });
  }

  function submit(ta, send) {
    if (state.sending) return;
    var id = state.open ? postId(state.open) : null;
    var text = String(ta.value || '').trim();
    var box = threadBox();
    if (!id || !box) return;

    var old = box.querySelector('.hvxf-note');
    if (old) old.parentNode.removeChild(old);

    if (!text) { box.appendChild(note('bad', 'Write something first.')); return; }

    state.sending = true;
    send.disabled = true;
    send.textContent = 'Posting...';

    var restore = function () {
      state.sending = false;
      send.disabled = false;
      send.textContent = 'Post comment';
    };

    fetch(API_COMMENTS + '?post=' + encodeURIComponent(id), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token()
      },
      body: JSON.stringify({ text: text })
    })
      .then(function (r) {
        return r.json()
          .then(function (d) { return { status: r.status, body: d || {} }; })
          .catch(function () { return { status: r.status, body: {} }; });
      })
      .then(function (res) {
        restore();
        if (!state.open || postId(state.open) !== id) return;

        if (res.status === 401) {
          paintComments([]);
          askSignIn('Your session expired. Please sign in again.');
          loadComments();
          return;
        }

        if (res.status >= 400) {
          var box2 = threadBox();
          if (box2) {
            box2.appendChild(note('bad',
              res.body.error || 'That comment could not be posted.'));
          }
          return;
        }

        /* A held comment must say so. One that silently disappears into a
           queue gets written again, and again. */
        ta.value = '';
        loadComments();
        var msg = res.body.message ||
          (res.body.status === 'held'
            ? 'Thanks. This one is waiting to be checked before it appears.'
            : 'Posted.');
        window.setTimeout(function () {
          var box3 = threadBox();
          if (box3 && state.open && postId(state.open) === id) {
            box3.appendChild(note(res.body.status === 'held' ? 'ok' : 'ok', msg));
          }
        }, 60);
      })
      .catch(function () {
        restore();
        var box4 = threadBox();
        if (box4) box4.appendChild(note('bad', 'The comment could not be sent.'));
      });
  }

  /* ---------------- dialog ---------------- */

  function buildDialog() {
    var overlay = node('div', 'hvxf-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Highlight');
    overlay.hidden = true;
    overlay.innerHTML = '' +
      '<div class="hvxf-dialog">' +
        '<div class="hvxf-dhead">' +
          '<div>' +
            '<p class="hvxf-dtitle" data-hvxf-title></p>' +
            '<p class="hvxf-meta">' +
              '<span class="hvxf-artist" data-hvxf-artist></span> ' +
              '<span class="hvxf-date" data-hvxf-date></span>' +
            '</p>' +
          '</div>' +
          '<button class="hvxf-close" type="button" aria-label="Close" data-hvxf-close>X</button>' +
        '</div>' +
        '<div class="hvxf-dimg" data-hvxf-img hidden></div>' +
        '<p class="hvxf-dcap" data-hvxf-cap></p>' +
        '<div class="hvxf-comments" data-hvxf-thread></div>' +
      '</div>';

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    overlay.querySelector('[data-hvxf-close]')
      .addEventListener('click', function () { close(); });

    document.body.appendChild(overlay);
    return overlay;
  }

  function open(item) {
    if (!dialog) dialog = buildDialog();
    state.open = item;
    state.lastFocus = document.activeElement;

    var title = String((item && item.title) || '').trim();
    var cat = String((item && item.category) || '').trim();
    dialog.querySelector('[data-hvxf-title]').textContent =
      title || cat || 'Highlight';
    dialog.querySelector('[data-hvxf-artist]').textContent =
      String((item && item.artist) || 'HVX').toUpperCase();
    dialog.querySelector('[data-hvxf-date]').textContent =
      String((item && item.date) || '');

    var imgBox = dialog.querySelector('[data-hvxf-img]');
    if (item && item.dataUrl) {
      imgBox.innerHTML = '<img src="' + esc(sized(item.dataUrl, 1200)) +
        '" alt="' + esc(title || 'Highlight') + '" decoding="async" />';
      imgBox.hidden = false;
    } else {
      imgBox.innerHTML = '';
      imgBox.hidden = true;
    }

    var cap = dialog.querySelector('[data-hvxf-cap]');
    cap.textContent = String((item && item.caption) || '');
    cap.hidden = !cap.textContent;

    dialog.hidden = false;
    /* Let the browser paint the hidden state once so the transition runs. */
    window.requestAnimationFrame(function () { dialog.classList.add('hvxf-open'); });
    document.documentElement.style.overflow = 'hidden';
    dialog.querySelector('[data-hvxf-close]').focus();

    loadComments();
  }

  function close() {
    if (!dialog || dialog.hidden) return;
    dialog.classList.remove('hvxf-open');
    state.open = null;
    state.sending = false;
    document.documentElement.style.overflow = '';
    window.setTimeout(function () {
      if (!state.open) dialog.hidden = true;
    }, 260);
    if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
      state.lastFocus.focus();
    }
    state.lastFocus = null;
  }

  /* ---------------- wiring ---------------- */

  function onClick(e) {
    var chip = e.target.closest ? e.target.closest('[data-hvxf-cat]') : null;
    if (chip) {
      state.category = chip.getAttribute('data-hvxf-cat') || ALL;
      render();
      return;
    }
    var card = e.target.closest ? e.target.closest('[data-hvxf-open]') : null;
    if (card) {
      var at = parseInt(card.getAttribute('data-hvxf-open'), 10);
      var rows = visible();
      if (rows[at]) open(rows[at]);
    }
  }

  function start() {
    var root = document.getElementById('hvx-feed');
    if (!root) return;

    load().then(function (items) {
      state.items = items;

      var section = document.getElementById('highlights');
      if (!items.length) {
        /* Stay out of the page entirely rather than show an empty grid. */
        if (section) section.hidden = true;
        return;
      }
      if (section) section.hidden = false;
      document.querySelectorAll('.js-highlights-entry').forEach(function (li) {
        li.hidden = false;
      });

      render();
      root.addEventListener('click', onClick);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') close();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
