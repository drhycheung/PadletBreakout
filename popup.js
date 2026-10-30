(async () => {
  const status = document.getElementById('status');
  const list = document.getElementById('list');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/padlet\.com/i.test(tab.url || '')) {
    status.textContent = 'Open a Padlet board to use this.';
    return;
  }

  let key = '';
  try { const u = new URL(tab.url); key = u.origin + u.pathname; } catch (e) { }

  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all)
    .filter(([k, v]) => k.startsWith(key + '::') && typeof v === 'string' && v);

  if (!entries.length) {
    status.textContent = 'No breakout links saved for this board yet.';
  } else {
    status.textContent = entries.length + ' saved section(s) on this board.';
    for (const [k, v] of entries) {
      const section = k.slice((key + '::').length);

      const li = document.createElement('li');

      const a = document.createElement('a');
      a.href = '#';
      a.textContent = section;
      a.title = v;
      a.addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: v }); });

      const copy = document.createElement('button');
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => navigator.clipboard.writeText(v).catch(() => {}));

      const del = document.createElement('button');
      del.textContent = '✕';
      del.title = 'Delete';
      del.addEventListener('click', async () => {
        await chrome.storage.local.remove(k);
        li.remove();
        status.textContent = (list.children.length) + ' saved section(s) on this board.';
      });

      li.appendChild(a);
      li.appendChild(copy);
      li.appendChild(del);
      list.appendChild(li);
    }
  }

  document.getElementById('rescan').addEventListener('click', () => {
    chrome.tabs.sendMessage(tab.id, { type: 'PBB_RESCAN' });
    status.textContent = 'Re-scan sent to the page.';
  });

  document.getElementById('openall').addEventListener('click', async () => {
    const all2 = await chrome.storage.local.get(null);
    const urls = Object.entries(all2)
      .filter(([k, v]) => k.startsWith(key + '::') && typeof v === 'string' && v)
      .map(([, v]) => v);
    urls.forEach((u) => chrome.tabs.create({ url: u }));
  });
})();
