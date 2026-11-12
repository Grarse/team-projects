const { test } = require('node:test');
const assert = require('node:assert/strict');
const { allocate, valueAt, minimumTerm, LIMIT, MAX_AMOUNT } = require('./model.js');

const base = { amount: 30_000_000, rate: 15, count: 3, openingYear: 2026, firstTerm: 5 };

test('30 million at 15% is split equally when every account is under the threshold', () => {
  const plan = allocate(base);
  assert.deepEqual(plan.accounts.map(a => a.contribution), [10_000_000, 10_000_000, 10_000_000]);
  assert.deepEqual(plan.transfers, []);
  assert.deepEqual(plan.accounts.map(a => a.closeYear), [2031, 2032, 2033]);
  assert.equal(plan.invested, base.amount);
  assert.equal(plan.overflow, 0);
  assert.equal(plan.totalTax, 0);
});

test('no-excess button target respects equal shares and whole-ruble rounding', () => {
  const { accounts, maxWithoutExcess } = allocate(base);
  assert.ok(accounts[0].maxContribution > accounts[1].maxContribution);
  assert.ok(accounts[1].maxContribution > accounts[2].maxContribution);
  assert.equal(maxWithoutExcess, 48_464_360);
  const plan = allocate({ ...base, amount: maxWithoutExcess });
  assert.deepEqual(plan.accounts.map(a => a.contribution), [16_154_787, 16_154_787, 16_154_786]);
  assert.ok(plan.accounts.every((a) => a.profit <= LIMIT));
  assert.equal(plan.overflow, 0);
  assert.equal(plan.totalTax, 0);
  assert.equal(allocate({ ...base, amount: maxWithoutExcess + 1 }).overflow, 1);
});

test('excess from account 1 is added to account 2 before checking its cap', () => {
  const plan = allocate({ ...base, amount: 90_000_000 });
  assert.deepEqual(plan.accounts.map(a => a.initialContribution), [30_000_000, 30_000_000, 30_000_000]);
  assert.deepEqual(plan.transfers, [{ from: 1, to: 2, amount: 3_134_502 }, { from: 2, to: 3, amount: 12_574_565 }]);
  assert.deepEqual(plan.accounts.map(a => a.contribution), [26_865_498, 20_559_937, 42_574_565]);
  assert.equal(plan.overflow, 26_419_779);
  assert.deepEqual(plan.accounts.map(a => a.tax), [0, 0, 7_311_367]);
});

test('excess on the last account is taxed and not transferred backward', () => {
  const plan = allocate({ ...base, amount: 50_000_000 });
  assert.deepEqual(plan.transfers, []);
  assert.deepEqual(plan.accounts.map(a => a.contribution), [16_666_667, 16_666_667, 16_666_666]);
  assert.equal(plan.overflow, 511_880);
  assert.equal(plan.totalTax, 123_575);
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

test('range of valid inputs preserves cash and transfers only excess to the next account', () => {
  for (const count of [1, 2, 3]) for (const rate of [0, .0001, .01, 10, 15, 100]) {
    for (const firstTerm of [5, 10, 30]) for (const amount of [0, 1, 30_000_000, 100_000_000, MAX_AMOUNT]) {
      const result = allocate({ ...base, count, rate, firstTerm, amount });
      assert.equal(result.invested, amount);
      assert.equal(result.accounts.reduce((sum, a) => sum + a.contribution, 0), amount);
      assert.equal(result.accounts.length, count);
      const incoming = new Map(result.transfers.map(t => [t.to, t.amount]));
      const outgoing = new Map(result.transfers.map(t => [t.from, t.amount]));
      for (const t of result.transfers) assert.equal(t.to, t.from + 1);
      result.accounts.forEach((a, i) => {
        assert.equal(a.contribution, a.initialContribution + (incoming.get(a.id) ?? 0) - (outgoing.get(a.id) ?? 0));
        assert.ok(Math.abs(a.initialContribution - amount / count) < 1);
        assert.ok(a.profit >= 0 && a.deduction <= LIMIT);
        assert.ok(Number.isFinite(a.netCapital));
        assert.equal(a.netCapital, a.capital - a.tax);
        if (i < count - 1) assert.ok(a.profit <= LIMIT + 1e-8);
        if (outgoing.has(a.id)) assert.equal(a.contribution, a.maxContribution);
      });
      assert.equal(result.overflow === 0, amount <= result.maxWithoutExcess);
    }
  }
});

test('invalid values are rejected', () => {
  for (const values of [{ count: 0 }, { count: 4 }, { amount: -1 }, { amount: 0.5 }, { rate: NaN }, { rate: 101 }, { openingYear: 2023 }, { firstTerm: 31 }, { taxScale: 'invalid' }]) {
    assert.throws(() => allocate({ ...base, ...values }), RangeError);
  }
});
