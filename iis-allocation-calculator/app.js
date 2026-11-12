(() => {
  'use strict';

  const model = window.IisAllocation;
  const $ = (id) => document.getElementById(id);
  const form = $('settings');
  const chart = $('chart');
  const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const rub = (n) => fmt.format(n) + ' ₽';
  const pct = (n) => decimal.format(n) + '%';
  const colors = ['#69e2bd', '#afbbff', '#ffc18b'];
  let plan = null;
  let geometry = null;
  let cursor = 7;
  let view = 'profit';

  function parseField(el, mode) {
    const raw = el.value.trim();
    const value = mode === 'amount' ? raw.replace(/\s/g, '') : raw.replace(',', '.');
    if (mode === 'rate' ? !/^\d+(?:\.\d{1,4})?$/.test(value) : !/^\d+$/.test(value)) return NaN;
    return Number(value);
  }

  function yearsText(n) {
    return n + ' ' + (n % 100 >= 11 && n % 100 <= 14 ? 'лет' : n % 10 === 1 ? 'год' : n % 10 >= 2 && n % 10 <= 4 ? 'года' : 'лет');
  }

  function readInputs(adjustTerm) {
    const openingYear = parseField($('opening'));
    const min = model.minimumTerm(openingYear);
    $('term').min = String(min);
    if (adjustTerm && Number($('term').value) < min) $('term').value = String(min);
    $('term-hint').textContent = 'Минимальный срок для всех счетов: ' + yearsText(min) + '.';
    return {
      amount: parseField($('amount'), 'amount'),
      rate: parseField($('rate'), 'rate'),
      count: Number(form.querySelector('[name="count"]:checked').value),
      openingYear,
      firstTerm: parseField($('term')),
      convention: $('convention').value
    };
  }

  function bar(label, value, ratio, className) {
    return '<div class="bar-block"><div class="bar-label"><span>' + label + '</span><b>' + value + '</b></div>' +
      '<div class="bar-track ' + className + '" aria-hidden="true"><span style="width:' + Math.max(0, Math.min(100, ratio * 100)) + '%"></span></div></div>';
  }

  function render() {
    const total = plan.invested + plan.remaining;
    $('invested').textContent = rub(plan.invested);
    $('profit').textContent = rub(plan.totalProfit);
    $('capital').textContent = rub(plan.totalCapital);
    $('remaining').textContent = rub(plan.remaining);
    $('remaining-block').classList.toggle('has-rest', plan.remaining > 0);

    $('allocation-note').textContent = plan.remaining > 0
      ? rub(plan.remaining) + ' не вложено: расчетные лимиты выбранных ИИС заполнены. Остаток не включен в капитал и прибыль.'
      : plan.rate === 0
        ? 'При нулевой доходности прибыль не возникает, поэтому вся сумма направляется на первый ИИС.'
        : 'Чтобы использовать расчетный лимит прибыли на всех выбранных ИИС, нужен общий взнос ' + rub(plan.fullContribution) +
          (plan.additional > 0 ? ' (еще ' + rub(plan.additional) + ').' : '.');
    $('fill-limit').disabled = !Number.isFinite(plan.fullContribution) || plan.fullContribution > model.MAX_AMOUNT;
    $('fill-hint').textContent = plan.rate === 0
      ? 'При нулевой доходности заполнить лимит прибыли невозможно.'
      : plan.fullContribution > model.MAX_AMOUNT
        ? 'Расчетный взнос для заполнения превышает предел ввода.'
        : 'Подставит ' + rub(plan.fullContribution) + ' — предельный взнос на все выбранные ИИС.';
    $('rate-hint').textContent = plan.convention === 'daily'
      ? 'Номинальная ставка с ежедневной капитализацией.'
      : 'Эффективная ставка: годовой рост уже включает капитализацию.';
    $('legend').innerHTML = plan.accounts.map((a, i) =>
      '<span class="legend-item' + (a.contribution ? '' : ' empty') + '" style="--series:' + colors[i] + '">' +
      '<i></i><b>ИИС ' + a.id + '</b>' + (a.contribution ? '' : ' · без взноса') + '</span>'
    ).join('');
    $('close-plan').innerHTML = plan.accounts.map((a, i) =>
      '<div style="--series:' + colors[i] + '"><span>ИИС ' + a.id + ' · закрытие</span>' +
      '<strong>' + a.closeYear + '</strong><span>Через ' + yearsText(a.term) + (a.contribution ? '' : ' · без взноса') + '</span></div>'
    ).join('');
    $('accounts').innerHTML = plan.accounts.map((a, i) => {
      const share = total ? a.contribution / total : 0;
      const usage = a.profit / model.LIMIT;
      const max = Number.isFinite(a.maxContribution) ? rub(a.maxContribution) : 'без ограничения в модели';
      return '<article class="account' + (a.contribution ? '' : ' unfunded') + '" style="--series:' + colors[i] + '">' +
        '<div class="account-head"><h3><i></i> ИИС ' + a.id + '</h3><span>' + yearsText(a.term) + ' · ' + a.closeYear + '</span></div>' +
        '<p class="account-caption">' + (a.contribution ? 'Капитал к плановому закрытию' : 'Не задействован · остатка нет') + '</p>' +
        '<strong class="account-capital">' + rub(a.capital) + '</strong>' +
        bar('Вложено', rub(a.contribution), share, 'contribution') +
        '<p class="bar-note">' + pct(share * 100) + ' от общей суммы · ' + (Number.isFinite(a.maxContribution) ? 'взнос до ' : 'взнос ') + max + '</p>' +
        bar('Прибыль к закрытию', rub(a.profit), usage, 'limit') +
        '<p class="bar-note limit-label"><span>0 ₽</span><span>Лимит ' + rub(model.LIMIT) + '</span></p></article>';
    }).join('');
    $('cursor').max = String(plan.lastTerm);
    $('cursor').value = String(cursor);
    drawChart();
  }

  function update(adjustTerm = false) {
    const previous = plan;
    try {
      plan = model.allocate(readInputs(adjustTerm));
      cursor = !previous || cursor === previous.lastTerm ? plan.lastTerm : Math.min(cursor, plan.lastTerm);
      $('error').hidden = true;
      $('results').hidden = false;
      $('fill-limit').disabled = false;
      $('cursor').disabled = false;
      render();
    } catch (error) {
      plan = null;
      geometry = null;
      $('error').textContent = error.message;
      $('error').hidden = false;
      $('results').hidden = true;
      $('fill-limit').disabled = true;
      $('cursor').disabled = true;
      $('legend').replaceChildren();
      $('close-plan').replaceChildren();
      $('cursor-label').textContent = '—';
      $('readout').replaceChildren();
      chart.textContent = 'Исправьте параметры, чтобы пересчитать график.';
      chart.classList.add('chart-empty');
    }
  }

  function axisAmount(value) {
    if (value >= 1e12) return decimal.format(value / 1e12) + ' трлн';
    if (value >= 1e9) return decimal.format(value / 1e9) + ' млрд';
    if (value >= 1e6) return decimal.format(value / 1e6) + ' млн';
    if (value >= 1000) return decimal.format(value / 1000) + ' тыс.';
    return fmt.format(value);
  }

  function drawChart() {
    if (!plan) return;
    chart.classList.remove('chart-empty');
    const width = Math.max(240, chart.clientWidth);
    const height = width < 450 ? 235 : 300;
    const left = 53, right = 17, top = 29, bottom = height - 29;
    const maxData = Math.max(1, ...plan.accounts.map((a) => a[view]));
    let step = 10_000_000, ceiling = 33_000_000;
    if (view === 'capital') {
      const interval = maxData / 4;
      const power = 10 ** Math.floor(Math.log10(interval));
      step = [1, 2, 2.5, 5, 10].find((k) => k * power >= interval) * power;
      ceiling = Math.ceil(maxData / step) * step * 1.04;
    }
    const x = (year) => left + year / plan.lastTerm * (width - left - right);
    const y = (value) => bottom - value / ceiling * (bottom - top);
    geometry = { left, right, width };
    const parts = ['<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Динамика ' +
      (view === 'profit' ? 'прибыли' : 'капитала') + ' ИИС по годам до закрытия">'];

    for (let i = 0; i * step <= ceiling + step * 1e-10 && i < 8; i++) {
      const value = i * step, yy = y(value);
      if (view === 'profit' && value === model.LIMIT) continue;
      parts.push('<line class="gridline" x1="' + left + '" x2="' + (width - right) + '" y1="' + yy + '" y2="' + yy + '"/>' +
        '<text x="' + (left - 7) + '" y="' + (yy + 4) + '" text-anchor="end">' + axisAmount(value) + '</text>');
    }
    const plotWidth = width - left - right;
    const skip = Math.max(1, Math.ceil(plan.lastTerm / Math.max(4, Math.floor(plotWidth / 25))));
    for (let i = 0; i <= plan.lastTerm; i++) {
      if (i !== plan.lastTerm && (i % skip || (skip > 1 && plan.lastTerm - i < skip / 2))) continue;
      parts.push('<text x="' + x(i) + '" y="' + (height - 8) + '" text-anchor="middle">' + i + '</text>');
    }
    if (view === 'profit') {
      const yy = y(model.LIMIT);
      parts.push('<line class="threshold" x1="' + left + '" x2="' + (width - right) + '" y1="' + yy + '" y2="' + yy + '"/>' +
        '<text class="threshold-label" x="' + (left + 4) + '" y="' + (yy - 9) + '">Лимит вычета · 30 млн ₽</text>');
    }
    plan.accounts.forEach((a, i) => {
      parts.push('<line class="closing-line" x1="' + x(a.term) + '" x2="' + x(a.term) + '" y1="' + top + '" y2="' + bottom + '" stroke="' + colors[i] + '"/>');
    });
    parts.push('<line class="cursor-line" x1="' + x(cursor) + '" x2="' + x(cursor) + '" y1="' + top + '" y2="' + bottom + '"/>');
    plan.accounts.forEach((a, i) => {
      if (!a.contribution) {
        parts.push('<circle cx="' + x(a.term) + '" cy="' + y(0) + '" r="3.5" fill="#101b2b" stroke="' + colors[i] + '" stroke-width="1.4"/>');
        return;
      }
      const line = Array.from({ length: a.term * 4 + 1 }, (_, index) => {
        const t = index / 4;
        return x(t).toFixed(2) + ',' + y(model.valueAt(plan, a, t)[view]).toFixed(2);
      }).join(' ');
      const cy = y(model.valueAt(plan, a, cursor)[view]);
      parts.push('<polyline class="series" stroke="' + colors[i] + '" points="' + line + '"/>' +
        '<circle cx="' + x(a.term) + '" cy="' + y(a[view]) + '" r="4" fill="' + colors[i] + '"/>' +
        (cursor < a.term ? '<circle cx="' + x(cursor) + '" cy="' + cy + '" r="4" fill="' + colors[i] + '" stroke="#101b2b" stroke-width="1.5"/>' : ''));
    });
    chart.innerHTML = parts.join('') + '</svg>';
    $('cursor-label').textContent = yearsText(cursor) + ' · ' + (plan.openingYear + cursor);
    $('cursor').setAttribute('aria-valuetext', $('cursor-label').textContent);
    $('readout').innerHTML = plan.accounts.map((a, i) =>
      '<span style="--series:' + colors[i] + '"><i></i>ИИС ' + a.id + ' <b>' +
      (a.contribution ? rub(model.valueAt(plan, a, cursor)[view]) : 'не пополнен') +
      '</b>' + (a.contribution && cursor >= a.term ? ' <small>на закрытии</small>' : '') + '</span>').join('');
  }

  form.addEventListener('submit', (event) => { event.preventDefault(); update(true); });
  form.addEventListener('input', (event) => update(event.target.id === 'opening'));
  $('amount').addEventListener('blur', () => {
    const value = parseField($('amount'), 'amount');
    if (Number.isInteger(value) && value <= model.MAX_AMOUNT) $('amount').value = fmt.format(value);
  });
  $('fill-limit').addEventListener('click', () => {
    if (!plan || !Number.isFinite(plan.fullContribution) || plan.fullContribution > model.MAX_AMOUNT) return;
    $('amount').value = fmt.format(plan.fullContribution);
    update();
  });
  $('reset-example').addEventListener('click', () => {
    form.reset();
    view = 'profit';
    document.querySelector('[name="view"][value="profit"]').checked = true;
    cursor = 7;
    update(true);
  });
  document.querySelectorAll('[name="view"]').forEach((input) => input.addEventListener('change', () => {
    view = input.value;
    drawChart();
  }));
  $('cursor').addEventListener('input', () => { cursor = Number($('cursor').value); drawChart(); });
  function inspect(event) {
    if (!geometry || !plan) return;
    const local = event.clientX - chart.getBoundingClientRect().left;
    const selected = Math.max(0, Math.min(plan.lastTerm, Math.round((local - geometry.left) * plan.lastTerm / (geometry.width - geometry.left - geometry.right))));
    if (selected === cursor) return;
    cursor = selected;
    $('cursor').value = String(cursor);
    drawChart();
  }
  chart.addEventListener('pointermove', (event) => { if (event.pointerType === 'mouse') inspect(event); });
  chart.addEventListener('click', inspect);
  if (typeof ResizeObserver === 'function') new ResizeObserver(drawChart).observe(chart);
  else window.addEventListener('resize', drawChart);
  update();
})();
