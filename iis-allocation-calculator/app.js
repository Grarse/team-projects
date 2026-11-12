(() => {
  'use strict';

  const model = window.IisAllocation;
  const $ = (id) => document.getElementById(id);
  const form = $('settings');
  const rateInput = $('rate');
  const rateSlider = $('rate-slider');
  const comparisonChart = $('comparison-chart');
  const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const rub = (n) => fmt.format(n) + ' ₽';
  const pct = (n) => decimal.format(n) + '%';
  const metrics = [
    ['Вложено', 'invested', 'contribution'],
    ['Прибыль', 'profit', 'profit'],
    ['Капитал до НДФЛ', 'gross', 'capital'],
    ['НДФЛ', 'tax', 'tax'],
    ['Капитал после НДФЛ', 'net', 'netCapital']
  ];
  let plan = null;

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
      taxScale: $('tax-scale').value,
      balance: $('balance-mode').value
    };
  }

  function render() {
    $('invested').textContent = rub(plan.invested);
    $('profit').textContent = rub(plan.totalProfit);
    $('capital').textContent = rub(plan.totalCapital);
    $('total-tax').textContent = rub(plan.totalTax);
    $('hero-net').textContent = $('total-net').textContent = rub(plan.totalNet);
    $('hero-total').hidden = false;
    $('tax-hint').textContent = plan.taxScale === 'current'
      ? '13% до 2,4 млн ₽ налоговой базы за год, 15% с превышения.'
      : 'Гипотеза: 13 / 15 / 18 / 20 / 22%. Не действующая шкала для этих доходов.';
    $('balance-hint').textContent = plan.balance === 'profit'
      ? 'На более короткий срок нужен больший взнос, чтобы прибыль была близкой.'
      : 'Сохраняем взносы близкими, а излишек переносим на счета со свободным лимитом.';

    const adjustments = plan.accounts.filter((a) => a.contribution !== a.initialContribution);
    const distribution = adjustments.length
      ? (plan.balance === 'profit'
        ? 'Для выравнивания прибыли, относительно равных взносов: '
        : 'Взносы относительно равного деления: ') + adjustments.map((a) => {
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
    drawComparison();
  }

  function update(adjustTerm = false) {
    try {
      plan = model.allocate(readInputs(adjustTerm));
      $('error').hidden = true;
      $('results').hidden = false;
      render();
    } catch (error) {
      plan = null;
      $('error').textContent = error.message;
      $('error').hidden = false;
      $('results').hidden = true;
      $('hero-total').hidden = true;
      $('fill-limit').disabled = true;
      comparisonChart.innerHTML = '<p class="compare-empty">Исправьте параметры, чтобы пересчитать график.</p>';
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
    const accounts = plan.accounts.map((a) => {
      const rows = metrics.map(([label, kind, key]) => {
        const amount = a[key];
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
        '<header><h3><i aria-hidden="true"></i>ИИС ' + a.id + '</h3>' +
        '<span>' + a.closeYear + ' · ' + yearsText(a.term) + (a.contribution ? '' : ' · без взноса') + '</span></header>' +
        '<dl>' + rows + '</dl></section>';
    }).join('');
    comparisonChart.innerHTML = '<div class="compare-axis" aria-hidden="true">' +
      '<span class="compare-axis-unit">Шкала, ₽</span><div class="compare-axis-plot">' + axis + '</div></div>' +
      '<div class="compare-limit" aria-hidden="true"><div class="compare-limit-plot">' +
      '<span class="compare-limit-label">Лимит вычета · ' + axisAmount(model.LIMIT) + ' ₽</span></div></div>' +
      '<div class="compare-groups"><div class="compare-grid" aria-hidden="true">' + grid +
      '<i class="compare-reference"></i></div>' + accounts + '</div>';
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
    update(true);
  });
  update();
})();
