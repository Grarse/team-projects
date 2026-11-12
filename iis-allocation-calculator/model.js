(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IisAllocation = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LIMIT = 30_000_000;
  const MAX_AMOUNT = 1_000_000_000_000;
  const MAX_YEARS = 30;
  const TAX_SCALES = {
    current: [[2_400_000, .13], [Infinity, .15]],
    scenario: [[2_400_000, .13], [5_000_000, .15], [20_000_000, .18], [50_000_000, .20], [Infinity, .22]]
  };

  function incomeTax(base, scale) {
    let tax = 0, lower = 0;
    for (const [upper, rate] of TAX_SCALES[scale]) {
      if (base <= lower) break;
      tax += (Math.min(base, upper) - lower) * rate;
      lower = upper;
    }
    return Math.round(tax);
  }

  function minimumTerm(openingYear) {
    if (!Number.isInteger(openingYear) || openingYear < 2024 || openingYear > 2100) {
      throw new RangeError('Укажите год открытия от 2024 до 2100.');
    }
    return Math.min(10, Math.max(5, openingYear - 2021));
  }

  function profitFactor(rate, years, convention) {
    return convention === 'daily'
      ? Math.expm1(365 * years * Math.log1p(rate / 100 / 365))
      : Math.expm1(years * Math.log1p(rate / 100));
  }

  function allocate({ amount, rate, count, openingYear, firstTerm, convention = 'daily', taxScale = 'current' }) {
    if (!Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT) {
      throw new RangeError('Укажите сумму в целых рублях от 0 до 1 трлн ₽.');
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new RangeError('Укажите годовую доходность от 0 до 100%.');
    }
    if (!Number.isInteger(count) || count < 1 || count > 3) {
      throw new RangeError('Выберите от одного до трех ИИС.');
    }
    const minTerm = minimumTerm(openingYear);
    if (!Number.isInteger(firstTerm) || firstTerm < minTerm || firstTerm > MAX_YEARS) {
      throw new RangeError(`Срок до первого закрытия: от ${minTerm} до ${MAX_YEARS} полных лет.`);
    }
    if (!['daily', 'effective'].includes(convention)) throw new RangeError('Неизвестный тип доходности.');
    if (!Object.hasOwn(TAX_SCALES, taxScale)) throw new RangeError('Неизвестная шкала НДФЛ.');

    let remaining = amount;
    const accounts = Array.from({ length: count }, (_, i) => {
      const term = firstTerm + i;
      const factor = profitFactor(rate, term, convention);
      // Floor to a whole ruble so rounding the contribution cannot exceed the cap.
      const maxContribution = factor === 0 ? Infinity : Math.floor(LIMIT / factor);
      const contribution = Math.min(remaining, maxContribution);
      remaining -= contribution;
      return { id: i + 1, term, closeYear: openingYear + term, factor, maxContribution, contribution };
    });

    // Preserve the cap-first allocation, then invest the entire excess in the final account.
    accounts[accounts.length - 1].contribution += remaining;
    for (const a of accounts) {
      a.profit = a.contribution * a.factor;
      a.capital = a.contribution + a.profit;
      a.deduction = Math.min(a.profit, LIMIT);
      a.taxable = a.profit - a.deduction;
      // Every closing is in a different calendar year by construction.
      a.tax = incomeTax(a.taxable, taxScale);
      a.netCapital = a.capital - a.tax;
    }
    const totalProfit = accounts.reduce((total, account) => total + account.profit, 0);
    const fullContribution = accounts.reduce((total, account) => total + account.maxContribution, 0);
    const totalTax = accounts.reduce((total, account) => total + account.tax, 0);
    return {
      openingYear, firstTerm, minTerm, rate, convention, taxScale, accounts,
      invested: amount, overflow: remaining, totalProfit, totalCapital: amount + totalProfit,
      totalTax, totalNet: amount + totalProfit - totalTax,
      fullContribution, additional: Math.max(0, fullContribution - amount),
      lastTerm: accounts[accounts.length - 1].term
    };
  }

  function valueAt(plan, account, years) {
    const elapsed = Math.max(0, Math.min(years, account.term));
    const profit = account.contribution * profitFactor(plan.rate, elapsed, plan.convention);
    return { profit, capital: account.contribution + profit };
  }

  return { allocate, valueAt, profitFactor, minimumTerm, LIMIT, MAX_AMOUNT, MAX_YEARS };
});
