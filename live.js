// Live presence (visitor count + cursors) and private visit analytics.
// Backend: Supabase (Realtime for presence/cursors; one insert-only RPC for events, see backend/schema.sql).
// Everything no-ops if the key is missing or Supabase fails to load.
(function () {
  'use strict';
  var SUPABASE_URL = 'https://tkxmhslqtofzlhahjesh.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_1XVLyfzLuUb4ewvTy6jRoA_JgC72Htt'; // public anon key (safe to ship; it can only call portfolio_track)

  // ---------- ids & opt-out ----------
  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  function get(kind, k) { try { var s = store(kind); return s && s.getItem(k); } catch (e) { return null; } }
  function set(kind, k, v) { try { var s = store(kind); s && s.setItem(k, v); } catch (e) {} }
  function rid() { return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 24); }

  var qs = new URLSearchParams(location.search);
  // Ben's own browsers: open the site once with ?me=1. This browser's visits (past and future) are then
  // flagged as his in the database and left out of reports, and it stops sending new events. ?me=0 undoes it.
  var visitor = get('localStorage', 'pf_vid') || rid(); set('localStorage', 'pf_vid', visitor);
  var meParam = qs.get('me');
  if (meParam === '1') set('localStorage', 'pf_me', '1');
  if (meParam === '0') set('localStorage', 'pf_me', '');
  var isMe = get('localStorage', 'pf_me') === '1';
  var session = get('sessionStorage', 'pf_sid') || rid(); set('sessionStorage', 'pf_sid', session);

  // Personal tracking links: ?ref=<tag> (made with backend/link.cjs). The tag is remembered on this
  // device (first link wins) so later direct visits still attribute to it, and it is removed from
  // the address bar so a forwarded link doesn't get credited to the wrong person.
  var refNow = (qs.get('ref') || '').replace(/[^\w.-]/g, '').slice(0, 80);
  var refFirst = get('localStorage', 'pf_ref') || refNow;
  if (refNow && !get('localStorage', 'pf_ref')) set('localStorage', 'pf_ref', refNow);
  if (refNow && history.replaceState) {
    qs.delete('ref');
    var rest = qs.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
  }

  var place = { city: '', region: '', country: '', org: '' };
  var ready = !!SUPABASE_ANON_KEY;

  // ---------- analytics ----------
  function track(type, data, keepalive) {
    if (!ready || isMe) return;
    try {
      fetch(SUPABASE_URL + '/rest/v1/rpc/portfolio_track', {
        method: 'POST',
        keepalive: !!keepalive,
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ p_session: session, p_visitor: visitor, p_type: type, p_data: data || {} }),
      }).catch(function () {});
    } catch (e) {}
  }

  function browserName() {
    var u = navigator.userAgent;
    if (/Edg\//.test(u)) return 'Edge'; if (/OPR\//.test(u)) return 'Opera'; if (/Chrome\//.test(u)) return 'Chrome';
    if (/Firefox\//.test(u)) return 'Firefox'; if (/Safari\//.test(u)) return 'Safari'; return 'Other';
  }
  function scrollPct() {
    var h = document.documentElement.scrollHeight - innerHeight;
    return h > 0 ? Math.min(100, Math.round((scrollY / h) * 100)) : 100;
  }
  var maxScroll = 0;
  var dwell = {};
  addEventListener('scroll', function () { maxScroll = Math.max(maxScroll, scrollPct()); }, { passive: true });

  function lookupPlace() {
    // Approximate location + network owner (e.g. a company or university) from the visitor's IP.
    var ctl = 'AbortController' in window ? new AbortController() : null;
    var t = setTimeout(function () { ctl && ctl.abort(); }, 2500);
    return fetch('https://ipapi.co/json/', ctl ? { signal: ctl.signal } : {})
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { place = { city: j.city || '', region: j.region || '', country: j.country_name || '', org: j.org || '' }; })
      .catch(function () {})
      .then(function () { clearTimeout(t); });
  }

  function startAnalytics() {
    var utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].map(function (k) { return qs.get(k) ? k.slice(4) + '=' + qs.get(k) : ''; }).filter(Boolean).join('&');
    track('visit', {
      referrer: document.referrer ? document.referrer.slice(0, 300) : '',
      ref: refNow || refFirst, ref_first: refFirst, ref_returning: !refNow && !!refFirst, utm: utm, path: location.pathname + location.hash,
      org: place.org, city: place.city, region: place.region, country: place.country,
      tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ''), lang: navigator.language || '',
      device: matchMedia('(pointer:coarse)').matches ? 'mobile/tablet' : 'desktop',
      browser: browserName(), screen: screen.width + 'x' + screen.height,
    });

    // Sections and projects seen (once each, after 1.5 s in view)
    var seen = {};
    var ids = ['work', 'mindcode', 'pipit', 'finance', 'bentimes', 'nfl', 'board', 'research', 'fog', 'emg', 'babson', 'experience', 'about', 'contact'];

    // Dwell time: seconds each section/project spends at least 35% on screen while the tab is visible.
    var visible = {};
    if ('IntersectionObserver' in window) {
      var dio = new IntersectionObserver(function (es) {
        es.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
      }, { threshold: 0.35 });
      ids.forEach(function (id) { var el = document.getElementById(id); el && dio.observe(el); });
      setInterval(function () {
        if (document.visibilityState !== 'visible') return;
        Object.keys(visible).forEach(function (id) { if (visible[id]) dwell[id] = (dwell[id] || 0) + 1; });
      }, 1000);
    }
    if ('IntersectionObserver' in window) {
      var timers = {};
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          var id = e.target.id;
          if (seen[id]) return;
          if (e.isIntersecting) timers[id] = setTimeout(function () { seen[id] = 1; track('section', { section: id }); }, 1500);
          else clearTimeout(timers[id]);
        });
      }, { threshold: 0.35 });
      ids.forEach(function (id) { var el = document.getElementById(id); el && io.observe(el); });
    }

    // Outbound / contact clicks
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest && ev.target.closest('a[href]');
      if (!a) return;
      var h = a.getAttribute('href');
      if (h.charAt(0) === '#') return;
      var target = /^mailto:/.test(h) ? 'email' : /linkedin\.com/.test(h) ? 'linkedin' : (/\.pdf($|\?)/.test(h) || a.dataset.track === 'resume') ? 'resume'
        : /github\.com\/Emeraldd123\/?$/.test(h) ? 'github-profile' : /github\.com/.test(h) ? 'github-repo'
        : /mindcode1\.netlify\.app\/api/.test(h) ? 'mindcode-built-app' : /mindcode1\.netlify\.app/.test(h) ? 'mindcode-demo'
        : /bensnotes/.test(h) ? 'bens-notes-app' : 'other';
      var card = a.closest('article, section, footer');
      track('click', { target: target, href: h.slice(0, 200), from: card ? card.id : '' }, true);
    }, true);

    // Demo videos watched for 4+ seconds
    document.querySelectorAll('video').forEach(function (v) {
      var logged = false, last = 0, watched = 0;
      v.addEventListener('timeupdate', function () {
        var d = v.currentTime - last; last = v.currentTime;
        if (d > 0 && d < 1) watched += d;
        if (!logged && watched >= 4) {
          logged = true;
          var card = v.closest('article');
          track('video', { video: card ? card.id : v.getAttribute('src') });
        }
      });
    });

    // Time on page: heartbeat every 20 s while the tab is visible (max ~10 min), and on leave
    var beats = 0;
    var hb = setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      if (++beats > 30) return clearInterval(hb);
      track('heartbeat', { scroll: maxScroll, dwell: dwell });
    }, 20000);
    var left = false;
    addEventListener('pagehide', function () { if (!left) { left = true; track('leave', { scroll: maxScroll, dwell: dwell }, true); } });
  }

  // ---------- live presence + cursors ----------
  var pill = document.getElementById('live-pill');
  var layer = null, cursors = {};
  var COLORS = ['#2fc896', '#e58a3a', '#8ea8ff', '#e3b341', '#c779d0', '#5fd0e0', '#ff7a8a'];
  var me = { color: COLORS[parseInt(visitor.slice(0, 6), 36) % COLORS.length] };

  function setCount(n) {
    if (!pill) return;
    pill.hidden = false;
    pill.querySelector('b').textContent = n;
    pill.querySelector('span').textContent = n === 1 ? 'here now' : 'here now';
    pill.title = n === 1 ? "Just you right now" : n + ' people are on this page right now';
  }

  function cursorEl(id, color, label) {
    if (!layer) { layer = document.createElement('div'); layer.className = 'cursor-layer'; layer.setAttribute('aria-hidden', 'true'); document.body.appendChild(layer); }
    var c = cursors[id];
    if (!c) {
      var el = document.createElement('div');
      el.className = 'peer-cursor';
      el.innerHTML = '<svg width="18" height="20" viewBox="0 0 18 20"><path d="M1 1l6.5 17 2.6-7.2L17 8.4z" fill="' + color + '" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg><span></span>';
      el.querySelector('span').style.background = color;
      layer.appendChild(el);
      c = cursors[id] = { el: el, t: 0 };
    }
    c.el.querySelector('span').textContent = label;
    return c;
  }
  function removeCursor(id) { var c = cursors[id]; if (c) { c.el.remove(); delete cursors[id]; } }
  setInterval(function () { var now = Date.now(); Object.keys(cursors).forEach(function (id) { if (now - cursors[id].t > 6000) removeCursor(id); }); }, 2000);

  function startLive() {
    if (!window.supabase || !window.supabase.createClient) return;
    var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    var ch = client.channel('portfolio-live', { config: { presence: { key: session }, broadcast: { self: false } } });
    var label = place.city ? 'Someone in ' + place.city : 'A visitor';

    ch.on('presence', { event: 'sync' }, function () { setCount(Object.keys(ch.presenceState()).length); });
    ch.on('presence', { event: 'leave' }, function (p) { removeCursor(p.key); });
    ch.on('broadcast', { event: 'cursor' }, function (msg) {
      var d = msg.payload || {};
      if (!d.id || d.id === session) return;
      var c = cursorEl(d.id, d.color || '#2fc896', d.label || 'A visitor');
      c.t = Date.now();
      // x as a fraction of viewport width; y in document pixels, so cursors land on the same content
      c.el.style.transform = 'translate(' + Math.round(d.x * innerWidth) + 'px,' + Math.round(d.y) + 'px)';
      c.el.style.opacity = d.out ? '0' : '1';
    });
    ch.subscribe(function (status) {
      if (status !== 'SUBSCRIBED') return;
      ch.track({ at: Date.now() });
      if (matchMedia('(pointer:coarse)').matches) return; // phones count, but have no cursor to share
      var lastSent = 0, pending = null;
      function send(payload) {
        var now = Date.now();
        pending = payload;
        if (now - lastSent < 60) return;
        lastSent = now;
        ch.send({ type: 'broadcast', event: 'cursor', payload: pending });
      }
      document.addEventListener('mousemove', function (e) {
        send({ id: session, x: e.clientX / innerWidth, y: e.pageY, color: me.color, label: label });
      }, { passive: true });
      document.addEventListener('mouseleave', function () { send({ id: session, x: 0, y: 0, out: true }); });
    });
  }

  if (ready) window.__pfTrack = track; // track() itself skips Ben's own browser
  if (ready && meParam === '1') {
    // Tell the database this visitor id is Ben (sent even though tracking is now off), then tidy the URL.
    try {
      fetch(SUPABASE_URL + '/rest/v1/rpc/portfolio_track', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ p_session: 'owner-' + visitor.slice(0, 20), p_visitor: visitor, p_type: 'owner', p_data: { device: navigator.userAgent.slice(0, 160) } }),
      }).catch(function () {});
    } catch (e) {}
    if (history.replaceState) { qs.delete('me'); var r2 = qs.toString(); history.replaceState(null, '', location.pathname + (r2 ? '?' + r2 : '') + location.hash); }
    var note = document.createElement('div');
    note.className = 'me-note';
    note.textContent = "Got it: this browser is yours and won't be counted in your visitor stats.";
    document.body.appendChild(note);
    setTimeout(function () { note.remove(); }, 6000);
  }
  if (!ready) return;
  lookupPlace().then(function () {
    startAnalytics();
    startLive();
  });

  // ---------- "Hiring? Say hi" ----------
  var dlg = document.getElementById('hi-dialog');
  var openBtn = document.getElementById('hi-open');
  if (dlg && openBtn) {
    openBtn.hidden = false;
    openBtn.addEventListener('click', function () { dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', ''); });
    dlg.querySelector('[data-close]').addEventListener('click', function () { dlg.close(); });
    dlg.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, val = function (n) { return (f.elements[n].value || '').trim().slice(0, 300); };
      if (!val('name') && !val('company')) { f.querySelector('.hi-msg').textContent = 'Add at least your name or company.'; return; }
      track('intro', { name: val('name'), company: val('company'), role: val('role'), email: val('email'), note: val('note') });
      f.innerHTML = '<p class="hi-thanks">Thanks, I got it. I\'ll be in touch soon.</p><div class="hi-actions"><button type="button" class="btn" data-close>Close</button></div>';
      f.querySelector('[data-close]').addEventListener('click', function () { dlg.close(); });
    });
  }
})();

// ---------- one-field "drop your LinkedIn" box ----------
(function () {
  var f = document.getElementById('li-box');
  if (!f || !window.__pfTrack) return;
  f.hidden = false;
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = f.querySelector('.li-msg');
    var v = (f.elements.linkedin.value || '').trim();
    if (!/linkedin\.com\/(in|company)\/[^\s/]+/i.test(v)) { msg.textContent = 'Paste a LinkedIn profile link, like linkedin.com/in/your-name.'; return; }
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
    window.__pfTrack('intro', { linkedin: v.slice(0, 200), source: 'linkedin-box' });
    f.querySelector('.li-row').remove();
    msg.textContent = "Got it, thanks. I'll reach out on LinkedIn.";
  });
})();
