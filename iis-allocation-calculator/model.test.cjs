const { test } = require('node:test');
const assert = require('node:assert/strict');
const { allocate, valueAt, minimumTerm, LIMIT, MAX_AMOUNT } = require('./model.js');

const base = { amount: 30_000_000, rate: 15, count: 3, openingYear: 2026, firstTerm: 5 };

test('profit mode balances the screenshot example across different closing terms', () => {
  const plan = allocate({ ...base, amount: 70_000_000, rate: 11.9, balance: 'profit' });
  assert.deepEqual(plan.accounts.map(a => a.contribution), [29_100_166, 22_702_836, 18_196_998]);
  const profits = plan.accounts.map(a => a.profit);
  assert.ok(Math.max(...profits) - Math.min(...profits) < 1);
  assert.equal(plan.totalTax, 0);
});

test('profit mode preserves all caps and invests the remaining capital on the last account', () => {
  const input = { ...base, balance: 'profit' };
  const cap = allocate(input).maxWithoutExcess;
  const full = allocate({ ...input, amount: cap });
  assert.ok(full.accounts.every(a => a.contribution === a.maxContribution && a.profit <= LIMIT));
  assert.equal(full.overflow, 0);
  const above = allocate({ ...input, amount: cap + 1_000_000 });
  assert.equal(above.overflow, 1_000_000);
  assert.equal(above.accounts.at(-1).contribution, full.accounts.at(-1).contribution + 1_000_000);
  assert.ok(above.totalTax > 0);
});

test('profit mode handles zero yield and indivisible whole rubles', () => {
  const plan = allocate({ ...base, amount: 7, rate: 0, balance: 'profit' });
  assert.deepEqual(plan.accounts.map(a => a.contribution), [3, 2, 2]);
  assert.equal(plan.totalProfit, 0);
  assert.equal(plan.totalTax, 0);
});

test('30 million at 15% is split equally when every account is under the threshold', () => {
  const plan = allocate(base);
  assert.deepEqual(plan.accounts.map(a => a.contribution), [10_000_000, 10_000_000, 10_000_000]);
  assert.deepEqual(plan.accounts.map(a => a.closeYear), [2031, 2032, 2033]);
  assert.equal(plan.invested, base.amount);
  assert.equal(plan.overflow, 0);
  assert.equal(plan.totalTax, 0);
});

test('no-excess button target fills the combined capacity of all accounts', () => {
  const { accounts, maxWithoutExcess } = allocate(base);
  assert.ok(accounts[0].maxContribution > accounts[1].maxContribution);
  assert.ok(accounts[1].maxContribution > accounts[2].maxContribution);
  assert.equal(maxWithoutExcess, 63_580_221);
  const plan = allocate({ ...base, amount: maxWithoutExcess });
  assert.deepEqual(plan.accounts.map(a => a.contribution), [26_865_498, 20_559_937, 16_154_786]);
  assert.ok(plan.accounts.every((a) => a.profit <= LIMIT));
  assert.equal(plan.overflow, 0);
  assert.equal(plan.totalTax, 0);
  assert.equal(allocate({ ...base, amount: maxWithoutExcess + 1 }).overflow, 1);
});

test('deduction usage and savings combine accounts with different closing years', () => {
  const input = { ...base, amount: 800_000, rate: 100, count: 2, convention: 'effective' };
  const { deduction } = allocate(input);
  assert.equal(deduction.limit, 60_000_000);
  assert.equal(Math.round(deduction.used), 37_600_000);
  assert.equal(Math.round(deduction.remainingProfit), 22_400_000);
  assert.equal(deduction.additionalContribution, 643_931);
  assert.equal(deduction.taxSavings, 5_544_000);
  assert.equal(allocate({ ...input, taxScale: 'scenario' }).deduction.taxSavings, 6_476_000);
});

test('deduction savings subtract the tax on any profit that exceeds the limit', () => {
  const plan = allocate({ ...base, amount: 1_000_000, rate: 100, count: 1, convention: 'effective' });
  assert.equal(plan.totalTax, 130_000);
  assert.deepEqual(plan.deduction, {
    limit: 30_000_000, used: 30_000_000, remainingProfit: 0,
    additionalContribution: 0, taxSavings: 4_472_000
  });
});

test('100 million of annual income puts all 90 million of deductible profit in the 22% bracket', () => {
  const input = { ...base, balance: 'profit', taxScale: 'scenario', otherIncome: 100_000_000 };
  const amount = allocate(input).maxWithoutExcess;
  const plan = allocate({ ...input, amount });
  assert.deepEqual(plan.accounts.map(a => a.closeYear), [2031, 2032, 2033]);
  assert.equal(plan.totalTax, 0);
  assert.equal(plan.deduction.taxSavings, 19_800_000);
  assert.equal(allocate({ ...input, amount, otherIncome: 0 }).deduction.taxSavings, 16_206_000);
});

test('IIS tax uses only the part of combined tax attributable to the account', () => {
  const input = { ...base, amount: 1_000_000, rate: 100, count: 1, convention: 'effective' };
  const scenario = allocate({ ...input, taxScale: 'scenario', otherIncome: 49_500_000 });
  assert.equal(scenario.totalTax, 210_000);
  assert.equal(scenario.deduction.taxSavings, 6_600_000);
  const current = allocate({ ...input, otherIncome: 3_000_000 });
  assert.equal(current.totalTax, 150_000);
  assert.equal(current.deduction.taxSavings, 4_500_000);
});

test('when all caps are filled the remaining capital stays on the last account', () => {
  const plan = allocate({ ...base, amount: 90_000_000 });
  assert.deepEqual(plan.accounts.map(a => a.initialContribution), [30_000_000, 30_000_000, 30_000_000]);
  assert.deepEqual(plan.accounts.map(a => a.contribution), [26_865_498, 20_559_937, 42_574_565]);
  assert.equal(plan.overflow, 26_419_779);
  assert.deepEqual(plan.accounts.map(a => a.tax), [0, 0, 7_311_367]);
});

test('60 million at 14% reallocates the last account excess to the two earlier accounts', () => {
  const plan = allocate({ ...base, amount: 60_000_000, rate: 14, taxScale: 'scenario' });
  assert.deepEqual(plan.accounts.map(a => a.initialContribution), [20_000_000, 20_000_000, 20_000_000]);
  assert.deepEqual(plan.accounts.map(a => a.contribution), [20_985_337, 20_985_337, 18_029_326]);
  assert.equal(plan.maxWithoutExcess, 70_426_690);
  assert.equal(plan.overflow, 0);
  assert.equal(plan.totalTax, 0);
  assert.equal(plan.equalTax, 443_867);
  assert.equal(Math.round(plan.equalNet), 139_424_774);
  assert.equal(Math.round(plan.totalNet), 138_884_846);
});

test('reallocation can cap a second account and send the remaining budget to the first', () => {
  const plan = allocate({ ...base, amount: 61_000_000 });
  assert.deepEqual(plan.accounts.map(a => a.contribution), [24_285_277, 20_559_937, 16_154_786]);
  assert.equal(plan.overflow, 0);
  assert.equal(plan.totalTax, 0);
});

test('300 million uses the marginal 13/15 tax brackets and leaves no money idle', () => {
  const plan = allocate({ ...base, amount: 300_000_000 });
  assert.deepEqual(plan.accounts.map(a => a.contribution), [26_865_498, 20_559_937, 252_574_565]);
  assert.deepEqual(plan.accounts.map(a => a.tax), [0, 0, 65_807_964]);
  assert.equal(Math.round(plan.accounts[2].taxable), 439_039_758);
  assert.equal(Math.round(plan.totalNet), 763_231_794);
});

test('scenario scale changes tax but does not change allocation or gross profit', () => {
  const input = { ...base, amount: 300_000_000 };
  const current = allocate(input);
  const scenario = allocate({ ...input, taxScale: 'scenario' });
  assert.deepEqual(scenario.accounts.map(a => a.contribution), current.accounts.map(a => a.contribution));
  assert.equal(scenario.totalProfit, current.totalProfit);
  assert.equal(scenario.totalTax, 94_990_747);
});

test('with one account all capital is invested, including the taxable excess', () => {
  const plan = allocate({ ...base, count: 1 });
  assert.equal(plan.accounts[0].contribution, base.amount);
  assert.ok(plan.overflow > 0);
  assert.ok(plan.totalTax > 0);
  assert.equal(plan.accounts[0].deduction, LIMIT);
});

test('effective rate uses annual compound growth rather than nominal daily accrual', () => {
  const effective = allocate({ ...base, convention: 'effective' });
  assert.equal(effective.accounts[0].maxContribution, Math.floor(LIMIT / (1.15 ** 5 - 1)));
  assert.ok(effective.maxWithoutExcess > allocate(base).maxWithoutExcess);
});

test('zero capital and zero rate work without NaN or imaginary profit', () => {
  assert.deepEqual(allocate({ ...base, amount: 0 }).accounts.map(a => a.capital), [0, 0, 0]);
  const flat = allocate({ ...base, rate: 0 });
  assert.deepEqual(flat.accounts.map(a => a.contribution), [10_000_000, 10_000_000, 10_000_000]);
  assert.equal(flat.totalProfit, 0);
  assert.equal(flat.maxWithoutExcess, Infinity);
});

test('opening year determines a common legal minimum; later closures get their own dates', () => {
  assert.deepEqual([2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2045].map(minimumTerm), [5, 5, 5, 6, 7, 8, 9, 10, 10]);
  assert.throws(() => allocate({ ...base, openingYear: 2027 }), /от 6/);
  const nextYear = allocate({ ...base, openingYear: 2027, firstTerm: 6 });
  assert.deepEqual(nextYear.accounts.map(a => a.closeYear), [2033, 2034, 2035]);
});

test('chart starts at principal and freezes values at closing', () => {
  const plan = allocate(base);
  const a = plan.accounts[0];
  assert.deepEqual(valueAt(plan, a, 0), { capital: a.contribution, profit: 0 });
  assert.deepEqual(valueAt(plan, a, 7), { capital: a.capital, profit: a.profit });
  assert.ok(valueAt(plan, a, 3).capital < a.capital);
});

test('range of valid inputs preserves capital and uses every cap before allowing excess', () => {
  for (const count of [1, 2, 3]) for (const rate of [0, .0001, .01, 10, 15, 100]) {
    for (const firstTerm of [5, 10, 30]) for (const amount of [0, 1, 30_000_000, 100_000_000, MAX_AMOUNT]) {
      const result = allocate({ ...base, count, rate, firstTerm, amount });
      assert.equal(result.invested, amount);
      assert.equal(result.accounts.reduce((sum, a) => sum + a.contribution, 0), amount);
      assert.equal(result.accounts.length, count);
      result.accounts.forEach((a, i) => {
        assert.ok(Math.abs(a.initialContribution - amount / count) < 1);
        assert.ok(a.profit >= 0 && a.deduction <= LIMIT);
        assert.ok(Number.isFinite(a.netCapital));
        assert.equal(a.netCapital, a.capital - a.tax);
        if (i < count - 1 || result.overflow === 0) assert.ok(a.profit <= LIMIT + 1e-8);
        if (result.overflow > 0) assert.equal(a.contribution, a.maxContribution + (i === count - 1 ? result.overflow : 0));
      });
      const free = result.accounts.filter(a => a.contribution < a.maxContribution);
      if (free.length > 0) {
        const smallestFree = Math.min(...free.map(a => a.contribution));
        assert.ok(result.accounts.every(a => a.contribution <= smallestFree + 1));
      }
      assert.equal(result.overflow === 0, amount <= result.maxWithoutExcess);
    }
  }
});

test('invalid values are rejected', () => {
  for (const values of [{ count: 0 }, { count: 4 }, { amount: -1 }, { amount: 0.5 }, { rate: NaN }, { rate: 101 }, { openingYear: 2023 }, { firstTerm: 31 }, { taxScale: 'invalid' }, { balance: 'invalid' }, { otherIncome: -1 }, { otherIncome: 2.5 }, { otherIncome: MAX_AMOUNT + 1 }]) {
    assert.throws(() => allocate({ ...base, ...values }), RangeError);
  }
});
