(() => {
  'use strict';
  const list = document.querySelector('.projects');
  if (!list) return;
  const cards = Array.from(list.querySelectorAll('[data-project]'));
  const cacheKey = 'Grarse/team-projects:last-changes:v1';
  const cacheLifetime = 10 * 60 * 1000;
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Yekaterinburg', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

  function applyDate(card, value) {
    if (!validDate(value)) return;
    // A cached response must not overwrite a newer date shipped with this page.
    if (Date.parse(value) < Date.parse(card.dataset.updated)) return;
    card.dataset.updated = value;
    const time = card.querySelector('time');
    time.dateTime = value;
    time.textContent = formatter.format(new Date(value));
    time.title = formatter.format(new Date(value)) + ' (UTC+5)';
  }

  function sortCards() {
    cards.sort((a, b) => Date.parse(b.dataset.updated) - Date.parse(a.dataset.updated)
      || a.dataset.project.localeCompare(b.dataset.project, 'en'));
    cards.forEach(card => list.appendChild(card));
  }

  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(cacheKey)); } catch (_) { /* Storage is optional. */ }
  if (cached && cached.dates && typeof cached.dates === 'object') {
    cards.forEach(card => applyDate(card, cached.dates[card.dataset.project]));
  }
  sortCards();
  const completeCache = cached && cards.every(card => validDate(cached.dates?.[card.dataset.project]));
  if (completeCache && Number.isFinite(cached.savedAt)
    && Date.now() >= cached.savedAt && Date.now() - cached.savedAt < cacheLifetime) return;

  const dates = {};
  cards.forEach(card => { dates[card.dataset.project] = card.dataset.updated; });
  Promise.allSettled(cards.map(async card => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const path = encodeURIComponent(card.dataset.project + '/');
      const response = await fetch('https://api.github.com/repos/Grarse/team-projects/commits?sha=main&path=' + path + '&per_page=1', {
        headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal,
        credentials: 'omit', referrerPolicy: 'no-referrer'
      });
      if (!response.ok) return;
      const commits = await response.json();
      const date = commits?.[0]?.commit?.committer?.date;
      if (!validDate(date)) return;
      applyDate(card, date);
      dates[card.dataset.project] = card.dataset.updated;
    } finally { clearTimeout(timeout); }
  })).then(() => {
    sortCards();
    try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), dates })); } catch (_) { /* Keep the static dates. */ }
  });
})();
