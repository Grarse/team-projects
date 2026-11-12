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

  function allocate({ amount, rate, count, openingYear, firstTerm, convention = 'daily', taxScale = 'current', balance = 'contribution' }) {
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
    if (!['contribution', 'profit'].includes(balance)) throw new RangeError('Неизвестный режим распределения.');

    const equalShare = Math.floor(amount / count);
    const extraRubles = amount % count;
    const accounts = Array.from({ length: count }, (_, i) => {
      const term = firstTerm + i;
      const factor = profitFactor(rate, term, convention);
      // Floor to a whole ruble so rounding the contribution cannot exceed the cap.
      const maxContribution = factor === 0 ? Infinity : Math.floor(LIMIT / factor);
      const initialContribution = equalShare + (i < extraRubles ? 1 : 0);
      return { id: i + 1, term, closeYear: openingYear + term, factor, maxContribution, initialContribution, contribution: initialContribution };
    });

    // Equal profit requires weights proportional to 1 / profit factor.
    // Re-split the unassigned budget whenever an account reaches its cap.
    let remaining = amount;
    let open = accounts;
    while (open.length) {
      const weights = balance === 'profit' && open[0].factor > 0
        ? open.map(a => open[0].factor / a.factor)
        : open.map(() => 1);
      const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
      const quotas = open.map((a, i) => ({ a, share: remaining * (weights[i] / weightSum) }));
      const capped = quotas.filter(({ a, share }) => share > a.maxContribution).map(({ a }) => a);
      if (capped.length === 0) {
        for (const { a, share } of quotas) {
          a.contribution = Math.floor(share);
          remaining -= a.contribution;
        }
        quotas.sort((x, y) => (y.share - y.a.contribution) - (x.share - x.a.contribution) || x.a.id - y.a.id);
        for (const { a } of quotas) {
          if (remaining > 0 && a.contribution < a.maxContribution) {
            a.contribution++;
            remaining--;
          }
        }
        break;
      }
      for (const a of capped) {
        a.contribution = a.maxContribution;
        remaining -= a.contribution;
      }
      open = open.filter((a) => !capped.includes(a));
    }
    const last = accounts[accounts.length - 1];
    const overflow = remaining;
    last.contribution += overflow;
    let equalTax = 0;
    let equalProfit = 0;
    for (const a of accounts) {
      a.profit = a.contribution * a.factor;
      a.capital = a.contribution + a.profit;
      a.deduction = Math.min(a.profit, LIMIT);
      a.taxable = a.profit - a.deduction;
      // Every closing is in a different calendar year by construction.
      a.tax = incomeTax(a.taxable, taxScale);
      a.netCapital = a.capital - a.tax;
      const initialProfit = a.initialContribution * a.factor;
      equalProfit += initialProfit;
      equalTax += incomeTax(Math.max(0, initialProfit - LIMIT), taxScale);
    }
    const totalProfit = accounts.reduce((total, account) => total + account.profit, 0);
    const maxWithoutExcess = accounts.reduce((total, a) => total + a.maxContribution, 0);
    const totalTax = accounts.reduce((total, account) => total + account.tax, 0);
    return {
      openingYear, firstTerm, minTerm, rate, convention, taxScale, balance, accounts,
      invested: amount, overflow, totalProfit, totalCapital: amount + totalProfit,
      totalTax, totalNet: amount + totalProfit - totalTax,
      equalTax, equalNet: amount + equalProfit - equalTax,
      maxWithoutExcess, lastTerm: last.term
    };
  }

  function valueAt(plan, account, years) {
    const elapsed = Math.max(0, Math.min(years, account.term));
    const profit = account.contribution * profitFactor(plan.rate, elapsed, plan.convention);
    return { profit, capital: account.contribution + profit };
  }

  return { allocate, valueAt, profitFactor, minimumTerm, LIMIT, MAX_AMOUNT, MAX_YEARS };
});
