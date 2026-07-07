/* ============================================================
   HVX MUSIC — Interactive Script v2
   ============================================================ */

(() => {

  // ── CUSTOM CURSOR ─────────────────────────────────────────
  const cursor   = document.getElementById('cursor');
  const follower = document.getElementById('cursor-follower');
  let mx = 0, my = 0, fx = 0, fy = 0;

  document.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    cursor.style.left = mx + 'px';
    cursor.style.top  = my + 'px';
  });

  (function animFollower() {
    fx += (mx - fx) * 0.12;
    fy += (my - fy) * 0.12;
    follower.style.left = fx + 'px';
    follower.style.top  = fy + 'px';
    requestAnimationFrame(animFollower);
  })();

  // Cursor scale on interactive elements
  const interactiveSelector = 'a, button, .artist-card, .filter-btn, .faq-question, .release-row, .about-card';
  document.querySelectorAll(interactiveSelector).forEach(el => {
    el.addEventListener('mouseenter', () => {
      cursor.style.transform = 'translate(-50%,-50%) scale(2)';
      cursor.style.background = 'transparent';
      cursor.style.border = '1.5px solid var(--accent)';
      follower.style.opacity = '0';
    });
    el.addEventListener('mouseleave', () => {
      cursor.style.transform = 'translate(-50%,-50%) scale(1)';
      cursor.style.background = 'var(--accent)';
      cursor.style.border = 'none';
      follower.style.opacity = '1';
    });
  });


  // ── SCROLL PROGRESS BAR ───────────────────────────────────
  const progressBar = document.getElementById('scroll-progress');
  function updateProgress() {
    const scrollTop = window.scrollY;
    const docH = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docH > 0 ? (scrollTop / docH) * 100 : 0;
    progressBar.style.width = pct + '%';
  }
  window.addEventListener('scroll', updateProgress, { passive: true });


  // ── NAV SCROLL ────────────────────────────────────────────
  const nav = document.getElementById('nav');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });


  // ── MOBILE MENU ───────────────────────────────────────────
  const hamburger  = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobile-menu');
  let menuOpen = false;

  hamburger.addEventListener('click', () => {
    menuOpen = !menuOpen;
    mobileMenu.classList.toggle('open', menuOpen);
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    const spans = hamburger.querySelectorAll('span');
    if (menuOpen) {
      spans[0].style.transform = 'translateY(6.5px) rotate(45deg)';
      spans[1].style.opacity   = '0';
      spans[2].style.transform = 'translateY(-6.5px) rotate(-45deg)';
    } else {
      spans.forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
    }
  });
  document.querySelectorAll('.mobile-link').forEach(link => {
    link.addEventListener('click', () => {
      menuOpen = false;
      mobileMenu.classList.remove('open');
      document.body.style.overflow = '';
      hamburger.querySelectorAll('span').forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
    });
  });


  // ── SCROLL REVEAL ─────────────────────────────────────────
  const baseReveal = '.stats-band,.section-header,.artist-card,.release-row,.about-card,.footer-top,.faq-item,.channel-link,.service-card,.demo-tips,.demo-text';

  const revealObs = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        const delay = (i * 0.07);
        entry.target.style.transitionDelay = delay + 's';
        entry.target.classList.add('visible');
        revealObs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll(baseReveal).forEach(el => {
    el.classList.add('reveal');
    revealObs.observe(el);
  });

  // Directional reveals
  const leftRevealObs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); leftRevealObs.unobserve(e.target); } });
  }, { threshold: 0.15 });
  document.querySelectorAll('.about-text, .contact-text, .faq-header').forEach(el => {
    el.classList.add('reveal-left'); leftRevealObs.observe(el);
  });

  const rightRevealObs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); rightRevealObs.unobserve(e.target); } });
  }, { threshold: 0.15 });
  document.querySelectorAll('.about-visual, .contact-form, .faq-list').forEach(el => {
    el.classList.add('reveal-right'); rightRevealObs.observe(el);
  });

  const scaleRevealObs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); scaleRevealObs.unobserve(e.target); } });
  }, { threshold: 0.2 });
  document.querySelectorAll('.vinyl-wrap').forEach(el => {
    el.classList.add('reveal-scale'); scaleRevealObs.observe(el);
  });


  // ── COUNTER ANIMATION ─────────────────────────────────────
  function animateCounter(el) {
    const target = +el.dataset.target;
    const duration = 1800;
    const step = target / (duration / 16);
    let current = 0;
    const timer = setInterval(() => {
      current += step;
      if (current >= target) { current = target; clearInterval(timer); }
      el.textContent = Math.round(current) + (target >= 100 ? '+' : target > 5 ? '+' : '');
    }, 16);
  }
  const counterObs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.querySelectorAll('.stat-num').forEach(animateCounter);
        counterObs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });
  const statsBand = document.querySelector('.stats-band');
  if (statsBand) counterObs.observe(statsBand);


  // ── ARTIST FILTER ─────────────────────────────────────────
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      document.querySelectorAll('.artist-card').forEach(card => {
        const show = filter === 'all' || card.dataset.genre === filter;
        card.style.transition = 'opacity 0.4s, transform 0.4s';
        card.style.opacity    = show ? '1' : '0.12';
        card.style.transform  = show ? 'scale(1)' : 'scale(0.96)';
        card.style.pointerEvents = show ? '' : 'none';
      });
    });
  });


  // ── RIPPLE ON BUTTONS ─────────────────────────────────────
  function addRipple(e) {
    const btn  = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const r    = Math.max(rect.width, rect.height);
    const x    = e.clientX - rect.left - r / 2;
    const y    = e.clientY - rect.top  - r / 2;
    const rip  = document.createElement('span');
    rip.className = 'ripple';
    rip.style.cssText = `width:${r}px;height:${r}px;left:${x}px;top:${y}px`;
    btn.appendChild(rip);
    rip.addEventListener('animationend', () => rip.remove());
  }
  document.querySelectorAll('.btn').forEach(btn => btn.addEventListener('click', addRipple));


  // ── CLICK PARTICLE BURST ──────────────────────────────────
  const COLORS = ['#a259ff','#ff6b35','#ffffff','#c084fc','#fb923c'];
  document.addEventListener('click', e => {
    for (let i = 0; i < 8; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      const angle = (i / 8) * 2 * Math.PI;
      const dist  = 40 + Math.random() * 40;
      p.style.cssText = `
        left:${e.clientX}px; top:${e.clientY}px;
        background:${COLORS[Math.floor(Math.random() * COLORS.length)]};
        --dx:${Math.cos(angle) * dist}px;
        --dy:${Math.sin(angle) * dist}px;
      `;
      document.body.appendChild(p);
      p.addEventListener('animationend', () => p.remove());
    }
  });


  // ── MAGNETIC BUTTONS ──────────────────────────────────────
  document.querySelectorAll('.btn-primary, .btn-outline').forEach(btn => {
    btn.addEventListener('mousemove', e => {
      const rect = btn.getBoundingClientRect();
      const dx   = e.clientX - (rect.left + rect.width  / 2);
      const dy   = e.clientY - (rect.top  + rect.height / 2);
      btn.style.transform = `translate(${dx * 0.25}px, ${dy * 0.25}px)`;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
    });
  });


  // ── FAQ ACCORDION ─────────────────────────────────────────
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item   = btn.closest('.faq-item');
      const answer = item.querySelector('.faq-answer');
      const isOpen = btn.getAttribute('aria-expanded') === 'true';

      // Close all others
      document.querySelectorAll('.faq-item').forEach(other => {
        if (other !== item) {
          other.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
          other.querySelector('.faq-answer').classList.remove('open');
        }
      });

      // Toggle current
      btn.setAttribute('aria-expanded', String(!isOpen));
      answer.classList.toggle('open', !isOpen);

      // Ripple on the icon
      addRipple({ currentTarget: btn, clientX: btn.getBoundingClientRect().right - 14,
                  clientY: btn.getBoundingClientRect().top + 14 });
    });
  });


  // ── ARTIST CARD TILT ──────────────────────────────────────
  document.querySelectorAll('.artist-card').forEach(card => {
    card.addEventListener('mousemove', e => {
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width  - 0.5;
      const y = (e.clientY - rect.top)  / rect.height - 0.5;
      card.style.transform = `perspective(600px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-4px)`;
    });
    card.addEventListener('mouseleave', () => { card.style.transform = ''; });
  });


  // ── RELEASE ROW HOVER ─────────────────────────────────────
  document.querySelectorAll('.release-row').forEach(row => {
    row.addEventListener('mouseenter', () => { row.style.background = 'rgba(162,89,255,0.04)'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });
  });


  // ── ABOUT CARD CLICK EXPAND ───────────────────────────────
  document.querySelectorAll('.about-card').forEach(card => {
    card.addEventListener('click', () => {
      card.classList.toggle('expanded');
      const val = card.querySelector('.ac-value');
      if (card.classList.contains('expanded')) {
        card.style.background = 'rgba(162,89,255,0.08)';
        card.style.borderColor = 'rgba(162,89,255,0.5)';
      } else {
        card.style.background = '';
        card.style.borderColor = '';
      }
    });
  });


  // ── AUDIO VISUALIZER (live random) ────────────────────────
  const bars = document.querySelectorAll('.bar');
  function randomizeBars() {
    bars.forEach(bar => {
      bar.style.setProperty('--h', (Math.random() * 85 + 10) + '%');
    });
  }
  setInterval(randomizeBars, 700);


  // ── ACTIVE NAV LINK ON SCROLL ─────────────────────────────
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-link');
  const sectionObs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navLinks.forEach(link => {
          link.classList.toggle('active', link.getAttribute('href') === '#' + entry.target.id);
        });
      }
    });
  }, { threshold: 0.35 });
  sections.forEach(s => sectionObs.observe(s));


  // ── CONTACT FORM ──────────────────────────────────────────
  const form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const emailEl = form.querySelector('[type="email"]');
      if (emailEl && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value)) {
        emailEl.style.borderColor = '#ef4444';
        emailEl.focus();
        setTimeout(() => { emailEl.style.borderColor = ''; }, 2500);
        return;
      }
      const btn = form.querySelector('button[type="submit"]');
      const orig = btn.textContent;
      btn.textContent = 'Message Sent &#10003;';
      btn.style.background = '#22c55e';
      setTimeout(() => { btn.textContent = orig; btn.style.background = ''; form.reset(); }, 3000);
    });
  }


  // ── SECTION ENTRANCE TEXT SCRAMBLE ────────────────────────
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#';
  function scramble(el) {
    const original = el.textContent;
    let iteration  = 0;
    const interval = setInterval(() => {
      el.textContent = original
        .split('')
        .map((char, idx) => {
          if (char === ' ') return ' ';
          if (idx < iteration) return original[idx];
          return chars[Math.floor(Math.random() * chars.length)];
        })
        .join('');
      if (iteration >= original.length) clearInterval(interval);
      iteration += 0.5;
    }, 30);
  }

  const scrambleObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        scramble(e.target);
        scrambleObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.8 });
  document.querySelectorAll('.section-tag').forEach(el => scrambleObs.observe(el));


  // ── VINYL SPEED UP ON HOVER ───────────────────────────────
  const vinyl = document.querySelector('.vinyl');
  if (vinyl) {
    let speed = 18;
    vinyl.addEventListener('mouseenter', () => {
      vinyl.style.animationDuration = '4s';
      document.querySelector('.vinyl-label').style.animationDuration = '4s';
    });
    vinyl.addEventListener('mouseleave', () => {
      vinyl.style.animationDuration = '18s';
      document.querySelector('.vinyl-label').style.animationDuration = '18s';
    });
    vinyl.addEventListener('click', () => {
      vinyl.style.animationPlayState =
        vinyl.style.animationPlayState === 'paused' ? 'running' : 'paused';
    });
  }


  // ── WIRE SOCIAL LINKS FROM CONFIG ────────────────────────
  const cfg = window.HVX_CONFIG;
  if (cfg) {
    document.querySelectorAll('[data-social]').forEach(el => {
      const key = el.dataset.social;
      if (cfg.social[key]) {
        el.href = cfg.social[key];
        if (cfg.social[key] !== '#') {
          el.target = '_blank';
          el.rel = 'noopener noreferrer';
        }
      }
    });
  }


  // ── RENDER ARTISTS FROM DATA ──────────────────────────────
  const artistsGrid   = document.getElementById('artists-grid');
  const artistsFilter = document.getElementById('artists-filter');

  if (artistsGrid && window.HVX && window.HVX.artists.length) {
    const data = window.HVX.artists;

    // Build genre filter buttons dynamically
    if (artistsFilter) {
      const genres = [...new Set(data.filter(a => !a.placeholder).map(a => a.genre))];
      if (genres.length > 1) {
        genres.forEach(g => {
          const btn = document.createElement('button');
          btn.className = 'filter-btn';
          btn.dataset.filter = g;
          btn.textContent = g;
          artistsFilter.appendChild(btn);
        });
        artistsFilter.style.display = '';
      }
    }

    // Render cards
    data.forEach(artist => {
      const card = document.createElement('div');
      card.className = 'artist-card';
      card.dataset.genre = artist.genre;

      const imgHTML = artist.photo
        ? `<img src="${artist.photo}" alt="${artist.name}" class="artist-img" style="width:100%;height:100%;object-fit:cover;">`
        : `<div class="artist-img-placeholder"><span>${artist.placeholder ? 'COMING SOON' : 'ARTIST'}</span></div>`;

      const socialHTML = (!artist.placeholder && artist.social)
        ? `<div class="artist-social">
             <a href="${artist.social.instagram}" target="_blank" rel="noopener noreferrer" class="social-link">IG</a>
             <a href="${artist.social.soundcloud}" target="_blank" rel="noopener noreferrer" class="social-link">SC</a>
             <a href="${artist.social.spotify}"   target="_blank" rel="noopener noreferrer" class="social-link">SP</a>
           </div>`
        : '';

      card.innerHTML = `
        <div class="artist-img-wrap">
          ${imgHTML}
          <div class="artist-overlay">${socialHTML}</div>
        </div>
        <div class="artist-info">
          <span class="artist-genre">${artist.genre}</span>
          <h3 class="artist-name">${artist.placeholder ? 'Coming Soon' : artist.name}</h3>
          <p class="artist-bio">${artist.bio}</p>
        </div>`;

      artistsGrid.appendChild(card);

      card.addEventListener('mousemove', e => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width  - 0.5;
        const y = (e.clientY - rect.top)  / rect.height - 0.5;
        card.style.transform = `perspective(600px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-4px)`;
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
      card.classList.add('reveal');
      revealObs.observe(card);
    });

    // Filter logic for dynamically created buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        document.querySelectorAll('.artist-card').forEach(card => {
          const show = filter === 'all' || card.dataset.genre === filter;
          card.style.transition   = 'opacity 0.4s, transform 0.4s';
          card.style.opacity      = show ? '1' : '0.12';
          card.style.transform    = show ? 'scale(1)' : 'scale(0.96)';
          card.style.pointerEvents = show ? '' : 'none';
        });
      });
    });
  }


  // ── RENDER RELEASES FROM DATA ─────────────────────────────
  const releasesList = document.getElementById('releases-list');

  if (releasesList && window.HVX) {
    const releases = window.HVX.releases || [];

    if (releases.length === 0) {
      releasesList.innerHTML =
        `<div class="releases-empty">
           <p class="releases-empty-label">Catalog</p>
           <p class="releases-empty-msg">First releases coming soon.</p>
         </div>`;
    } else {
      releases.forEach(r => {
        const date = r.date
          ? new Date(r.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
          : '--';

        const listenUrl = r.links
          ? (r.links.spotify || r.links.beatport || r.links.soundcloud || r.links.appleMusic || null)
          : null;

        const row = document.createElement('div');
        row.className = 'release-row';
        row.innerHTML =
          `<div class="release-artwork">${r.art ? `<img src="${r.art}" alt="${r.title}" style="width:100%;height:100%;object-fit:cover;border-radius:2px;">` : ''}</div>
           <span class="release-date">${date}</span>
           <div class="release-info">
             <p class="release-artist">${r.artist}</p>
             <p class="release-title">${r.title}</p>
           </div>
           <span class="release-genre">${r.genre}</span>
           ${listenUrl
             ? `<a href="${listenUrl}" target="_blank" rel="noopener noreferrer" class="release-link">Listen Now</a>`
             : `<span class="release-link" style="opacity:.35;cursor:default;">Soon</span>`}`;

        row.addEventListener('mouseenter', () => { row.style.background = 'rgba(162,89,255,0.04)'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        row.classList.add('reveal');
        revealObs.observe(row);
        releasesList.appendChild(row);
      });
    }
  }


  // ── FORM HANDLER (demo + booking) ────────────────────────
  function initForm(id, successText, resetText) {
    const form = document.getElementById(id);
    if (!form) return;
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      const emailEl = form.querySelector('[type="email"]');
      if (emailEl && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value)) {
        emailEl.style.borderColor = '#ef4444';
        emailEl.focus();
        setTimeout(() => { emailEl.style.borderColor = ''; }, 2500);
        return;
      }
      const btn  = form.querySelector('button[type="submit"]');
      const orig = btn.textContent;
      btn.textContent = successText;
      btn.style.background = '#22c55e';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent  = resetText || orig;
        btn.style.background = '';
        btn.disabled     = false;
        form.reset();
      }, 3500);
    });
  }

  initForm('demo-form',    'Submitted - We will be in touch',       'Submit Demo');
  initForm('booking-form', 'Request Sent - We will reply within 48h', 'Send Booking Request');

})();
