/*
 * Padlet Breakout Linker — page-world hook.
 *
 * Runs in Padlet's OWN JS context so it can patch window.fetch / XMLHttpRequest /
 * the clipboard before Padlet's code does, and read the board data.
 *
 * Two ways this script gets into the MAIN world:
 *   1. Declared in manifest.json with "world":"MAIN", "run_at":"document_start"
 *      (Chrome 111+). This is the early, primary install.
 *   2. As a belt-and-suspenders, content.js also fetches this file and injects it
 *      as a <script> tag, which ALWAYS runs in the main world even on older
 *      Chrome or if (1) is ignored. The __pbbHookInstalled guard prevents a
 *      double install.
 *
 * Real Padlet data shape (confirmed by inspection):
 *   wall_section = { ..., "attributes": { "title": "L01 Activity (1)",
 *                                        "breakoutLink": "<url> | null", ... } }
 * The title and breakoutLink live INSIDE the same `attributes` object.
 */
(function () {
  'use strict';
  if (window.__pbbHookInstalled) return;
  window.__pbbHookInstalled = true;

  function dbg(m) { try { console.log('[PBB] ' + m); } catch (e) { } }
  dbg('main-world hook installed');

  var BREAKOUT_RE = /https?:\/\/[^\s"'<>]*padlet\.com\/[^\s"'<>]*\/breakout-room\/[\w.-]+/i;

  function norm(t) {
    if (!t || typeof t !== 'string') return '';
    return t.replace(/\s+/g, ' ').trim().split(/\s{2,}/)[0];
  }

  function findTitle(node) {
    if (!node || typeof node !== 'object') return null;
    var a = node.attributes;
    var t = (a && typeof a === 'object')
      ? (a.title || a.name || a.display_name || a.label || null)
      : null;
    if (!t) {
      var keys = ['title', 'name', 'display_name', 'label', 'subject', 'heading', 'text'];
      for (var i = 0; i < keys.length; i++) {
        if (typeof node[keys[i]] === 'string' && node[keys[i]].trim()) { t = node[keys[i]]; break; }
      }
    }
    return t ? norm(t) : null;
  }

  function getLinkFrom(node) {
    if (typeof node.breakoutLink === 'string') return node.breakoutLink;
    if (node.attributes && typeof node.attributes.breakoutLink === 'string') return node.attributes.breakoutLink;
    var b = node.breakout || (node.attributes && node.attributes.breakout);
    if (b && typeof b === 'object') {
      var v = b.link || b.url || b.href || b.token || b.hashid || b.roomHashid;
      if (typeof v === 'string' && BREAKOUT_RE.test(v)) return v;
    }
    return null;
  }

  var pending = {};

  function captureNode(node) {
    if (!node || typeof node !== 'object') return;
    var link = getLinkFrom(node);
    if (link && BREAKOUT_RE.test(link)) {
      var ti = findTitle(node);
      if (ti) { pending[ti] = link; }
    }
  }

  function walk(node, seen) {
    if (!node || typeof node !== 'object' || node.nodeType === 1) return;
    if (seen.has(node)) return; seen.add(node);
    captureNode(node);
    if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) walk(node[i], seen); return; }
    for (var k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      var v = node[k];
      if (v && typeof v === 'object') walk(v, seen);
    }
  }

  function shouldScan(url, ct) {
    if (!url && !ct) return false;
    if (url && /wall_section|breakout|padlet_starting_state|starting_state/i.test(url)) return true;
    if (ct && ct.indexOf('json') !== -1) return true;
    return false;
  }

  function flush() {
    var map = {};
    for (var k in pending) { if (Object.prototype.hasOwnProperty.call(pending, k)) map[k] = pending[k]; }
    if (Object.keys(map).length) {
      try { window.postMessage({ __pbb_links: map }, '*'); } catch (e) { }
      dbg('captured ' + Object.keys(map).length + ' breakout link(s): ' + JSON.stringify(map));
    }
  }

  // Clipboard safety net: if Padlet copies a breakout link, capture it.
  // Covers BOTH copy mechanisms web apps use:
  //   - the async Clipboard API (navigator.clipboard.writeText)  -> patch below
  //   - the legacy document.execCommand('copy')                  -> 'copy' event below
  // Patch every clipboard-write entry point web apps use, so we capture the
  // breakout link at the moment Padlet writes it (no clipboard-READ permission
  // needed, and it works regardless of which API Padlet picks):
  //   1. navigator.clipboard.writeText(text)
  //   2. navigator.clipboard.write([ClipboardItem])   <- common in copy libraries
  //   3. document.execCommand('copy')                 <- legacy, fires a 'copy' event
  function captureText(t) {
    if (t && BREAKOUT_RE.test(t)) {
      try { window.postMessage({ __pbb_capture: t, __pbb_title: window.__pbbActiveTitle || null }, '*'); } catch (e) { }
    }
  }

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      var ow = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = function (t) {
        try { captureText(typeof t === 'string' ? t : (t && t.toString && t.toString())); } catch (e) { }
        return ow.apply(null, arguments);
      };
      dbg('clipboard writeText hook installed');
    }
  } catch (e) { }

  try {
    if (navigator.clipboard && typeof navigator.clipboard.write === 'function') {
      var owrite = navigator.clipboard.write.bind(navigator.clipboard);
      navigator.clipboard.write = function (items) {
        try {
          if (Array.isArray(items)) {
            for (var i = 0; i < items.length; i++) {
              var item = items[i];
              if (item && typeof item.getType === 'function') {
                Promise.resolve(item.getType('text/plain'))
                  .then(function (blob) { if (blob && blob.text) return blob.text(); })
                  .then(function (txt) { captureText(txt); })
                  .catch(function () { });
              }
            }
          }
        } catch (e) { }
        return owrite.apply(null, arguments);
      };
      dbg('clipboard write([ClipboardItem]) hook installed');
    }
  } catch (e) { }

  try {
    document.addEventListener('copy', function (e) {
      var data = e.clipboardData;
      var t = data && typeof data.getData === 'function' ? data.getData('text/plain') : '';
      captureText(t);
    });
    dbg('copy-event hook installed');
  } catch (e) { }

  function scanResponse(url, ct, text) {
    if (!shouldScan(url, ct)) return;
    if (url) dbg('scanning response: ' + url.slice(0, 90));
    try {
      var json = JSON.parse(text);
      walk(json, new Set());
      flush();
    } catch (e) { /* not JSON or parse error */ }
  }

  // fetch hook
  try {
    if (window.fetch && typeof window.fetch === 'function') {
      var realFetch = window.fetch.bind(window);
      window.fetch = function () {
        var args = arguments;
        return realFetch.apply(null, args).then(function (resp) {
          try {
            var u = resp.url || '';
            var ct = (resp.headers && resp.headers.get) ? resp.headers.get('content-type') : '';
            if (shouldScan(u, ct)) {
              resp.clone().text().then(function (txt) { scanResponse(u, ct, txt); }).catch(function () { });
            }
          } catch (e) { }
          return resp;
        }, function (e) { return Promise.reject(e); });
      };
    }
  } catch (e) { }

  // XMLHttpRequest hook (Padlet fetches board data via XHR)
  try {
    var RealOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, u) {
      this.__pbbUrl = (typeof u === 'string') ? u : ((u && u.url) || '');
      return RealOpen.apply(this, arguments);
    };
    var RealSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      xhr.addEventListener('load', function () {
        try {
          var ct = (xhr.getResponseHeader && xhr.getResponseHeader('content-type')) || '';
          scanResponse(xhr.__pbbUrl, ct, xhr.responseText);
        } catch (e) { }
      });
      return RealSend.apply(this, arguments);
    };
  } catch (e) { }
})();
