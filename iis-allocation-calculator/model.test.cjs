const { test } = require('node:test');
const assert = require('node:assert/strict');
const { allocate, valueAt, minimumTerm, LIMIT, MAX_AMOUNT } = require('./model.js');

const base = { amount: 30_000_000, rate: 15, count: 3, openingYear: 2026, firstTerm: 5 };

test('30 million at 15% fills account 1, then account 2, leaves account 3 unfunded', () => {
  const plan = allocate(base);
  assert.deepEqual(plan.accounts.map(a => a.contribution), [26_865_498, 3_134_502, 0]);
  assert.deepEqual(plan.accounts.map(a => a.closeYear), [2031, 2032, 2033]);
  assert.equal(plan.invested, base.amount);
  assert.equal(plan.remaining, 0);
});

test('later closing years require smaller maximum contributions at the same positive rate', () => {
  const { accounts, fullContribution } = allocate(base);
  assert.ok(accounts[0].maxContribution > accounts[1].maxContribution);
  assert.ok(accounts[1].maxContribution > accounts[2].maxContribution);
  const plan = allocate({ ...base, amount: fullContribution });
  for (const a of plan.accounts) {
    assert.equal(a.contribution, a.maxContribution);
    assert.ok(a.profit <= LIMIT && LIMIT - a.profit < a.profit / a.contribution);
  }
  assert.equal(plan.additional, 0);
  assert.equal(plan.remaining, 0);
});

test('cash over the combined cap stays unallocated and does not generate profit', () => {
  const fullContribution = allocate(base).fullContribution;
  const capped = allocate({ ...base, amount: fullContribution });
  const overflow = allocate({ ...base, amount: fullContribution + 1_000_000 });
  assert.equal(overflow.remaining, 1_000_000);
  assert.equal(overflow.totalProfit, capped.totalProfit);
  assert.equal(overflow.totalCapital, capped.totalCapital);
});

test('effective rate uses annual compound growth rather than nominal daily accrual', () => {
  const effective = allocate({ ...base, convention: 'effective' });
  assert.equal(effective.accounts[0].maxContribution, Math.floor(LIMIT / (1.15 ** 5 - 1)));
  assert.ok(effective.fullContribution > allocate(base).fullContribution);
});

test('zero capital and zero rate work without NaN or imaginary profit', () => {
  assert.deepEqual(allocate({ ...base, amount: 0 }).accounts.map(a => a.capital), [0, 0, 0]);
  const flat = allocate({ ...base, rate: 0 });
  assert.deepEqual(flat.accounts.map(a => a.contribution), [base.amount, 0, 0]);
  assert.equal(flat.totalProfit, 0);
  assert.equal(flat.fullContribution, Infinity);
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

test('range of valid inputs preserves cash and never funds a later account prematurely', () => {
  for (const count of [1, 2, 3]) for (const rate of [0, .0001, .01, 10, 15, 100]) {
    for (const firstTerm of [5, 10, 30]) for (const amount of [0, 1, 30_000_000, 100_000_000, MAX_AMOUNT]) {
      const result = allocate({ ...base, count, rate, firstTerm, amount });
      assert.equal(result.invested + result.remaining, amount);
      assert.equal(result.accounts.length, count);
      result.accounts.forEach((a, i) => {
        assert.ok(a.profit >= 0 && a.profit <= LIMIT + 1e-8);
        if (i > 0 && a.contribution > 0) {
          assert.equal(result.accounts[i - 1].contribution, result.accounts[i - 1].maxContribution);
        }
      });
    }
  }
});

test('invalid values are rejected', () => {
  for (const values of [{ count: 0 }, { count: 4 }, { amount: -1 }, { amount: 0.5 }, { rate: NaN }, { rate: 101 }, { openingYear: 2023 }, { firstTerm: 31 }]) {
    assert.throws(() => allocate({ ...base, ...values }), RangeError);
  }
});
