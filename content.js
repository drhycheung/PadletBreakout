/*
 * Padlet Breakout Linker — content script (isolated world).
 *
 * Responsibilities:
 *   - Inject the MAIN-world hook (inject.js) so it can read Padlet's network +
 *     clipboard (this works even if the manifest "world":"MAIN" declaration is
 *     ignored on older Chrome).
 *   - Place a small "open in new tab" (external-link) icon next to each
 *     section's three-dots menu.
 *   - On click: open that section's breakout room in a NEW tab. The link comes
 *     from (1) automatic capture (inject.js relays it) or, failing that,
 *     (2) a one-click fallback that opens Padlet's own "Copy breakout room link"
 *     menu item and uses the copied URL — so the user never copies/pastes by hand.
 */
(() => {
  'use strict';

  const SECTION_MENU_ARIA = 'Open section actions menu';
  const SECTION_SEL = 'section, [class*="surface-section"]';
  const TITLE_SEL = 'h1, h2, h3, h4, [role="heading"], [class*="heading" i], [class*="title" i]';
  const BREAKOUT_RE = /https?:\/\/[^\s"'<>]*padlet\.com\/[^\s"'<>]*\/breakout-room\/[\w.-]+/i;

  const store = chrome.storage.local;
  let ready = false;
  let activeTitle = null;                       // section whose menu is currently open
  const buttonsByTitle = new Map();             // section title -> 🔗 button element
  const menuByTitle = new Map();                // section title -> three-dots button

  function dbg(m) { try { console.log('[PBB] ' + m); } catch (e) { } }
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  function norm(t) {
    if (!t || typeof t !== 'string') return '';
    return t.replace(/\s+/g, ' ').trim().split(/\s{2,}/)[0];
  }

  // ---------- storage ----------
  // All chrome.storage access is defensively wrapped: if the extension was
  // reloaded and the page wasn't (or the context was otherwise torn down),
  // chrome.runtime.id becomes undefined and the calls would throw
  // "Extension context invalidated". We resolve safely instead of crashing.
  function contextAlive() { return !!(chrome.runtime && chrome.runtime.id); }

  function boardKey() { try { return location.origin + location.pathname; } catch (e) { return location.host; } }
  function storageKey(title) { return boardKey() + '::' + title; }

  function setLink(title, url) {
    return new Promise((resolve) => {
      try {
        if (!contextAlive()) { resolve(); return; }
        store.set({ [storageKey(title)]: url }, () => resolve());
      } catch (e) { resolve(); }
    });
  }
  function getLink(title) {
    return new Promise((resolve) => {
      try {
        if (!contextAlive()) { resolve(''); return; }
        store.get(storageKey(title), (r) => {
          if (chrome.runtime.lastError) { resolve(''); return; }
          resolve((r && r[storageKey(title)]) || '');
        });
      } catch (e) { resolve(''); }
    });
  }
  function clearLink(title) {
    return new Promise((resolve) => {
      try {
        if (!contextAlive()) { resolve(); return; }
        store.remove(storageKey(title), () => resolve());
      } catch (e) { resolve(); }
    });
  }

  // ---------- section detection ----------
  function sectionTitleFor(menuBtn) {
    const sec = menuBtn.closest(SECTION_SEL) || menuBtn.parentElement;
    const h = sec && sec.querySelector(TITLE_SEL);
    let t = (h ? h.textContent : '') || (sec ? sec.textContent : '') || '';
    t = norm(t);
    if (t.length > 80) t = t.slice(0, 80);
    return t || 'Section';
  }

  // ---------- MAIN-world hook injection (Chrome-version independent) ----------
  function installMainWorldHook() {
    if (window.__pbbHookInstalled) { dbg('main-world hook already present'); return; }
    try {
      fetch(chrome.runtime.getURL('inject.js'))
        .then(r => r.text())
        .then((src) => {
          const s = document.createElement('script');
          s.textContent = src;
          (document.head || document.documentElement || document).appendChild(s);
          if (s.parentNode) s.parentNode.removeChild(s);
          dbg('injected main-world hook via <script>');
        })
        .catch((e) => dbg('hook fetch failed: ' + e.message));
    } catch (e) { dbg('hook inject error: ' + e.message); }
  }

  // ---------- injection of the 🔗 button ----------
  function markReady(btn) { if (btn && !btn.classList.contains('pbb-ready')) btn.classList.add('pbb-ready'); }

  function positionNextTo(menuBtn, btn) {
    let host = menuBtn.offsetParent;
    let top = menuBtn.offsetTop;
    let left = menuBtn.offsetLeft;
    if (host && host.tagName === 'A') {            // never nest inside an anchor
      const real = host.offsetParent;
      top = host.offsetTop; left = host.offsetLeft; host = real;
    }
    if (!host) host = menuBtn.parentElement || document.body;
    btn.style.position = 'absolute';
    btn.style.top = top + 'px';
    btn.style.left = Math.max(0, left - 26) + 'px'; // 22px width + 4px gap, to the LEFT of the three-dots
    host.appendChild(btn);
  }

  function attachButton(menuBtn) {
    if (!menuBtn || menuBtn.dataset.pbbAttached) return;
    menuBtn.dataset.pbbAttached = '1';
    const title = sectionTitleFor(menuBtn);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pbb-open-btn';
    // Standard "open in new tab" glyph: a square with an arrow to the upper right.
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>';
    btn.title = 'Open breakout room for “' + title + '”  (Alt+click to clear)';
    btn.setAttribute('aria-label', 'Open breakout room for ' + title);
    btn.addEventListener('click', (e) => onButtonClick(e, title, btn));

    positionNextTo(menuBtn, btn);
    buttonsByTitle.set(title, btn);
    menuByTitle.set(title, menuBtn);
    getLink(title).then((url) => { if (url) markReady(btn); });
  }

  // ---------- click handling ----------
  async function onButtonClick(e, title, btn) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (!contextAlive()) {
      btn.title = 'Extension was updated — please reload this page (F5) so the buttons reconnect.';
      btn.classList.add('pbb-hint');
      setTimeout(() => btn.classList.remove('pbb-hint'), 4000);
      return;
    }

    if (e.altKey) {
      if (confirm('Clear the saved breakout link for “' + title + '” ?')) {
        await clearLink(title);
        btn.classList.remove('pbb-ready');
      }
      return;
    }

    const url = await getLink(title);
    if (url) {
      window.open(url, '_blank', 'noopener');     // new tab only; current tab never navigates
      return;
    }

    // No saved link yet: drive Padlet's own "Copy breakout room link" so the
    // user gets a one-click open without manual copy/paste. We then read the
    // copied URL back from the system clipboard (via the background page, which
    // holds the clipboardRead permission) and open it — so it works regardless
    // of how Padlet places the link on the clipboard.
    dbg('no saved link for “' + title + '” — using menu fallback');
    btn.classList.add('pbb-loading');
    btn.title = 'Fetching breakout link for “' + title + '”…';

    const menuBtn = menuByTitle.get(title);
    if (menuBtn) {
      window.__pbbActiveTitle = title;             // shared with the MAIN-world hook
      activeTitle = title;
      menuBtn.click();                            // open the section menu
      const clicked = await clickBreakoutMenuItem();
      if (clicked) {
        // Fast path: the MAIN-world hook should have captured it already
        // (it patches writeText / write([ClipboardItem]) / the copy event).
        let got = await waitForLink(title, 2000);
        // Secondary path: read the clipboard from the page context directly.
        if (!got) {
          await delay(300);
          const clip = await readClipboard();
          const m = clip && clip.match(BREAKOUT_RE);
          if (m) { got = m[0]; await setLink(title, got); }
        }
        if (got) {
          markReady(btn);
          btn.classList.remove('pbb-loading');
          window.open(got, '_blank', 'noopener');
          return;
        }
      }
      document.body && document.body.click();      // close any open menu
    }
    window.__pbbActiveTitle = null;

    btn.classList.remove('pbb-loading');
    btn.classList.add('pbb-hint');
    btn.title = 'Could not auto-find the breakout link for “' + title +
                '”. Open this section’s “⋯” menu and choose “Copy breakout room link” once.';
    setTimeout(() => { btn.classList.remove('pbb-hint'); btn.title = 'Open breakout room for “' + title + '”  (Alt+click to clear)'; }, 6000);
  }

  // Read the system clipboard from the page context (secondary fallback).
  // The primary capture is the MAIN-world hook, which needs no read permission.
  function readClipboard() {
    return new Promise((resolve) => {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
          navigator.clipboard.readText()
            .then((t) => resolve(t || ''))
            .catch((e) => { dbg('clipboard readText failed: ' + (e && e.message)); resolve(''); });
        } else {
          dbg('navigator.clipboard.readText unavailable');
          resolve('');
        }
      } catch (e) { dbg('clipboard read threw: ' + e.message); resolve(''); }
    });
  }

  async function clickBreakoutMenuItem() {
    const deadline = Date.now() + 1600;
    const re = /copy breakout room link|copy breakout link/i;
    while (Date.now() < deadline) {
      let target = null;
      const inMenu = Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button, button[role="menuitem"]'));
      target = inMenu.find(el => re.test((el.textContent || '').trim()));
      if (!target) {
        const all = Array.from(document.querySelectorAll('button, [role="menuitem"], a'));
        target = all.find(el => re.test((el.textContent || '').trim()));
      }
      if (target) { target.click(); return true; }
      await new Promise(r => setTimeout(r, 150));
    }
    return false;
  }

  async function waitForLink(title, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const u = await getLink(title);
      if (u) return u;
      await new Promise(r => setTimeout(r, 150));
    }
    return '';
  }

  // ---------- receive data from the MAIN-world hook (inject.js) ----------
  function applyLinks(map) {
    Object.entries(map || {}).forEach(([title, url]) => {
      if (!title || !url) return;
      setLink(title, url);
      const btn = buttonsByTitle.get(title);
      if (btn) markReady(btn);
    });
  }

  function captureFromClipboard(url, title) {
    const t = title || activeTitle;
    if (!t) return;                               // only attribute when a section menu is open
    activeTitle = null;
    setLink(t, url);
    const btn = buttonsByTitle.get(t);
    if (btn) markReady(btn);
  }

  function listenForPageMessages() {
    window.addEventListener('message', (e) => {
      if (!e || !e.data) return;
      if (typeof e.data.__pbb_capture === 'string') captureFromClipboard(e.data.__pbb_capture, e.data.__pbb_title);
      else if (e.data.__pbb_links) applyLinks(e.data.__pbb_links);
    });
  }

  // Track which section's menu is open (for the clipboard safety net).
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button[aria-label="' + SECTION_MENU_ARIA + '"]');
    if (b) activeTitle = sectionTitleFor(b);
  }, true);

  // ---------- wiring ----------
  function scan() {
    if (!ready) return;
    document.querySelectorAll('button[aria-label="' + SECTION_MENU_ARIA + '"]').forEach(attachButton);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'PBB_RESCAN') scan();
  });

  const observer = new MutationObserver(() => scan());
  function start() {
    ready = true;
    installMainWorldHook();
    listenForPageMessages();
    scan();
    const root = document.documentElement || document;
    observer.observe(root, { childList: true, subtree: true });
    setInterval(scan, 2000);
    dbg('content script started');
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
