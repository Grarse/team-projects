(() => {
  'use strict';

  const model = window.IisAllocation;
  const $ = (id) => document.getElementById(id);
  const form = $('settings');
  const rateInput = $('rate');
  const rateSlider = $('rate-slider');
  const chart = $('chart');
  const comparisonChart = $('comparison-chart');
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
    if (mode === 'rate' ? !/^\d+(?:\.\d)?$/.test(value) : !/^\d+$/.test(value)) return NaN;
    return Number(value);
  }

  function yearsText(n) {
    return n + ' ' + (n % 100 >= 11 && n % 100 <= 14 ? 'лет' : n % 10 === 1 ? 'год' : n % 10 >= 2 && n % 10 <= 4 ? 'года' : 'лет');
  }

  function readInputs(adjustTerm) {
    const rate = parseField(rateInput, 'rate');
    if (!Number.isFinite(rate) || rate < Number(rateSlider.min) || rate > Number(rateSlider.max)) {
      rateInput.setAttribute('aria-invalid', 'true');
      throw new RangeError('Укажите доходность от 5% до 30% с шагом 0,1 п. п.');
    }
    rateInput.removeAttribute('aria-invalid');
    rateSlider.value = String(rate);
    rateSlider.setAttribute('aria-valuetext', pct(rate) + ' годовых');
    const openingYear = parseField($('opening'));
    const min = model.minimumTerm(openingYear);
    $('term').min = String(min);
    if (adjustTerm && Number($('term').value) < min) $('term').value = String(min);
    $('term-hint').textContent = 'Минимальный срок для всех счетов: ' + yearsText(min) + '.';
    return {
      amount: parseField($('amount'), 'amount'),
      rate,
      count: Number(form.querySelector('[name="count"]:checked').value),
      openingYear,
      firstTerm: parseField($('term')),
      convention: $('convention').value,
      taxScale: $('tax-scale').value
    };
  }

  function bar(label, value, ratio, className) {
    return '<div class="bar-block"><div class="bar-label"><span>' + label + '</span><b>' + value + '</b></div>' +
      '<div class="bar-track ' + className + '" aria-hidden="true"><span style="width:' + Math.max(0, Math.min(100, ratio * 100)) + '%"></span></div></div>';
  }

  function profitBar(account) {
    const scale = Math.max(model.LIMIT, account.profit);
    const split = model.LIMIT / scale * 100;
    const covered = account.deduction / scale * 100;
    const excess = account.taxable / scale * 100;
    return '<div class="bar-block"><div class="bar-label"><span>Прибыль к закрытию</span><b>' + rub(account.profit) + '</b></div>' +
      '<div class="bar-track limit" style="--split:' + split + '%" aria-hidden="true">' +
      '<span style="width:' + covered + '%"></span><span class="taxable-fill" style="left:' + covered + '%;width:' + excess + '%"></span></div>' +
      '<p class="bar-note limit-label"><span>Вычет до ' + rub(model.LIMIT) + '</span>' +
      (account.taxable > 0 ? '<span class="over-limit">Сверх: ' + rub(account.taxable) + '</span>' : '') + '</p></div>';
  }

  function render() {
    $('invested').textContent = rub(plan.invested);
    $('profit').textContent = rub(plan.totalProfit);
    $('capital').textContent = rub(plan.totalCapital);
    $('total-tax').textContent = rub(plan.totalTax);
    $('total-net').textContent = rub(plan.totalNet);
    $('tax-hint').textContent = plan.taxScale === 'current'
      ? '13% до 2,4 млн ₽ налоговой базы за год, 15% с превышения.'
      : 'Гипотеза: 13 / 15 / 18 / 20 / 22%. Не действующая шкала для этих доходов.';

    const adjustments = plan.accounts.filter((a) => a.contribution !== a.initialContribution);
    const distribution = adjustments.length
      ? 'Взносы относительно равного деления: ' + adjustments.map((a) => {
        const delta = a.contribution - a.initialContribution;
        return 'ИИС ' + a.id + ' ' + (delta > 0 ? '+' : '−') + rub(Math.abs(delta));
      }).join('; ') + '.'
      : plan.accounts.length === 1
        ? 'Вся сумма вложена на один ИИС.'
        : plan.invested % plan.accounts.length === 0
          ? 'Взнос разделен поровну: по ' + rub(plan.accounts[0].initialContribution) + ' на счет.'
          : 'Взнос разделен поровну с точностью до рубля.';
    $('allocation-note').textContent = distribution + (plan.overflow > 0
      ? ' Все расчетные лимиты заполнены. Остаток ' + rub(plan.overflow) + ' вложен на ИИС ' + plan.accounts.length +
        '. НДФЛ начисляется на прибыль сверх вычета, не на взнос.'
      : adjustments.length ? ' Все счета остаются в пределах расчетного лимита прибыли.' : '');
    $('equal-note').hidden = !adjustments.length ||
      (plan.equalTax === plan.totalTax && Math.round(plan.equalNet) === Math.round(plan.totalNet));
    $('equal-note').textContent = 'Для сравнения: при равных взносах НДФЛ составил бы ' + rub(plan.equalTax) +
      ', а капитал после НДФЛ к датам закрытия — ' + rub(plan.equalNet) + '.';
    $('fill-limit').disabled = plan.maxWithoutExcess > model.MAX_AMOUNT;
    $('fill-hint').textContent = plan.rate === 0
      ? 'При нулевой доходности лимит прибыли не превышается.'
      : plan.maxWithoutExcess > model.MAX_AMOUNT
        ? 'В пределах доступных сумм лимит прибыли не превышается.'
        : 'Подставит ' + rub(plan.maxWithoutExcess) + ' — максимальный общий взнос без превышения при таком распределении.';
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
      const share = plan.invested ? a.contribution / plan.invested : 0;
      return '<article class="account' + (a.contribution ? '' : ' unfunded') + '" style="--series:' + colors[i] + '">' +
        '<div class="account-head"><h3><i></i> ИИС ' + a.id + '</h3><span>' + yearsText(a.term) + ' · ' + a.closeYear + '</span></div>' +
        '<p class="account-caption">' + (a.contribution ? 'Капитал после НДФЛ' : 'Не задействован · остатка нет') + '</p>' +
        '<strong class="account-capital">' + rub(a.netCapital) + '</strong>' +
        bar('Вложено', rub(a.contribution), share, 'contribution') +
        '<p class="bar-note">' + pct(share * 100) + ' от общей суммы' +
        (Number.isFinite(a.maxContribution) ? ' · без превышения: ' + rub(a.maxContribution) : '') + '</p>' +
        profitBar(a) +
        '<dl class="account-tax"><div><dt>Капитал до НДФЛ</dt><dd>' + rub(a.capital) + '</dd></div>' +
        '<div><dt>НДФЛ при закрытии</dt><dd>' + rub(a.tax) + '</dd></div></dl></article>';
    }).join('');
    $('cursor').max = String(plan.lastTerm);
    $('cursor').value = String(cursor);
    drawComparison();
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
      comparisonChart.innerHTML = '<p class="compare-empty">Исправьте параметры, чтобы пересчитать график.</p>';
      chart.textContent = 'Исправьте параметры, чтобы пересчитать график.';
      chart.classList.add('chart-empty');
    }
  }

  function axisAmount(value) {
    if (value >= 1e15) return value.toExponential(0);
    if (value >= 1e12) return decimal.format(value / 1e12) + ' трлн';
    if (value >= 1e9) return decimal.format(value / 1e9) + ' млрд';
    if (value >= 1e6) return decimal.format(value / 1e6) + ' млн';
    if (value >= 1000) return decimal.format(value / 1000) + ' тыс.';
    return fmt.format(value);
  }

  function chartStep(value) {
    const power = 10 ** Math.floor(Math.log10(value));
    return [1, 2, 2.5, 5, 10].find((factor) => factor * power >= value) * power;
  }

  function drawComparison() {
    const max = Math.max(model.LIMIT * 1.1, ...plan.accounts.map((a) => a.capital));
    const step = chartStep(max / 4);
    const ticks = Math.ceil(max / step);
    const scale = ticks * step;
    const position = (amount) => (100 * amount / scale).toFixed(5) + '%';
    comparisonChart.style.setProperty('--limit-position', position(model.LIMIT));

    const axis = Array.from({ length: ticks + 1 }, (_, i) =>
      '<span style="--position:' + position(i * step) + '">' + axisAmount(i * step) + '</span>'
    ).join('');
    const grid = Array.from({ length: ticks + 1 }, (_, i) =>
      '<i class="compare-gridline" style="--position:' + position(i * step) + '"></i>'
    ).join('');
    const accounts = plan.accounts.map((a, i) => {
      const metrics = [
        ['Вложено', 'invested', a.contribution],
        ['Прибыль', 'profit', a.profit],
        ['Капитал до НДФЛ', 'gross', a.capital],
        ['НДФЛ', 'tax', a.tax],
        ['Капитал после НДФЛ', 'net', a.netCapital]
      ];
      const rows = metrics.map(([label, kind, amount]) => {
        const taxable = kind === 'profit' && a.taxable > 0;
        const fill = taxable
          ? '<span class="compare-fill" style="--size:' + position(a.deduction) + '"></span>' +
            '<span class="compare-fill compare-excess" style="--from:' + position(a.deduction) + ';--size:' + position(a.taxable) + '"></span>'
          : '<span class="compare-fill" style="--size:' + position(amount) + '"></span>';
        const excess = taxable
          ? '<small class="compare-extra">Сверх вычета: ' + rub(a.taxable) + '</small>'
          : '';
        return '<div class="compare-row compare-' + kind + '"><dt>' + label + '</dt>' +
          '<dd class="compare-track" aria-hidden="true">' + fill + '</dd>' +
          '<dd class="compare-value">' + rub(amount) + excess + '</dd></div>';
      }).join('');
      return '<section class="compare-group" aria-label="ИИС ' + a.id + '">' +
        '<header><h3><i style="--series:' + colors[i] + '"></i>ИИС ' + a.id + '</h3>' +
        '<span>' + a.closeYear + ' · ' + yearsText(a.term) + (a.contribution ? '' : ' · без взноса') + '</span></header>' +
        '<dl>' + rows + '</dl></section>';
    }).join('');
    comparisonChart.innerHTML = '<div class="compare-axis" aria-hidden="true">' +
      '<span class="compare-axis-unit">Шкала, ₽</span><div class="compare-axis-plot">' + axis + '</div></div>' +
      '<div class="compare-groups"><div class="compare-grid" aria-hidden="true">' + grid +
      '<i class="compare-reference"></i></div>' + accounts + '</div>';
  }

  function drawChart() {
    if (!plan || $('timeline-panel').hidden) return;
    chart.classList.remove('chart-empty');
    const width = Math.max(240, chart.clientWidth);
    const height = width < 450 ? 235 : 300;
    const left = 53, right = 17, top = 29, bottom = height - 29;
    const maxData = Math.max(1, ...plan.accounts.map((a) => a[view]));
    let step = 10_000_000, ceiling = 33_000_000;
    if (view === 'capital' || maxData > model.LIMIT) {
      step = chartStep(maxData / 4);
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
  form.addEventListener('input', (event) => {
    if (event.target === rateSlider) rateInput.value = decimal.format(Number(rateSlider.value));
    update(event.target.id === 'opening');
  });
  $('amount').addEventListener('blur', () => {
    const value = parseField($('amount'), 'amount');
    if (Number.isInteger(value) && value <= model.MAX_AMOUNT) $('amount').value = fmt.format(value);
  });
  $('fill-limit').addEventListener('click', () => {
    if (!plan || plan.maxWithoutExcess > model.MAX_AMOUNT) return;
    $('amount').value = fmt.format(plan.maxWithoutExcess);
    update();
  });
  $('reset-example').addEventListener('click', () => {
    form.reset();
    view = 'profit';
    document.querySelector('[name="view"][value="profit"]').checked = true;
    cursor = 7;
    update(true);
  });
  document.querySelectorAll('[name="chart-mode"]').forEach((input) => input.addEventListener('change', () => {
    const compare = input.value === 'compare';
    $('overview').dataset.chartMode = input.value;
    $('comparison-panel').hidden = !compare;
    $('timeline-panel').hidden = compare;
    $('chart-title').textContent = compare ? 'Сравнение ИИС' : 'Динамика по счетам';
    drawChart();
  }));
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
