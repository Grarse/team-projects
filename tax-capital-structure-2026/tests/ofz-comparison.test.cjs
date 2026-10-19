const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../ofz-comparison-engine.js');
const near=(a,b,eps=.03)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const zero={insuranceFee:0,portfolioFee:0,brokerFee:0,insuranceTradeFee:0};
test('MOEX schedule, actual coupon accrual and leap-day calendar',()=>{
  assert.equal(E.COUPONS.length,32);
  assert.equal(E.COUPONS[0].amount,68.13);
  assert.equal(E.iso(E.COUPONS.at(-1).date),'2040-05-16');
  assert.equal(E.accrued(E.dateMs('2026-12-02')),0);
  assert.equal(E.accrued(E.dateMs('2026-10-19')),46.32);
  assert.equal(E.accrued(E.MATURITY),0);
  assert.equal(E.iso(E.addYears(E.dateMs('2028-02-29'),1)),'2029-02-28');
  assert.equal(E.minInsuranceYears(E.dateMs('2026-01-01')),5);
  assert.equal(E.minInsuranceYears(E.dateMs('2027-01-01')),6);
  assert.equal(E.minInsuranceYears(E.dateMs('2031-01-01')),10);
});
test('progression thresholds and tax rounding',()=>{
  assert.equal(E.tax(0),0);assert.equal(E.tax(-1),0);
  assert.equal(E.tax(2400000),312000);assert.equal(E.tax(5000000),702000);
  assert.equal(E.tax(20000000,'scenario'),3402000);
  assert.equal(E.tax(50000000,'scenario'),9402000);
  assert.equal(E.tax(60000000,'scenario'),11602000);
  assert.equal(E.tax(100),13);
});
test('one coupon: invested NKD is deducted once, not taxed or deducted twice',()=>{
  const p={...zero,amount:10000,start:'2026-07-01',end:'2026-12-02',price:100,pricePath:'flat',contracts:1,closeDates:['2026-12-02'],reinvest:false};
  const r=E.simulate(p),n=Math.floor(p.amount/(1000+E.accrued(E.dateMs(p.start))));
  const profit=n*(61.08-E.accrued(E.dateMs(p.start)));
  near(r.direct.net,p.amount+profit-E.tax(profit));
  near(r.insurance.net,r.direct.net);
  near(r.years.reduce((s,y)=>s+y.directCoupon,0),profit);
  assert.equal(r.insurance.benefit,0);
});
test('no coupon and no price change: no income tax; early exit has no exemption',()=>{
  const p={...zero,amount:1000000,start:'2026-12-02',end:'2026-12-03',price:100,pricePath:'flat',contracts:1,closeDates:['2026-12-03'],reinvest:false};
  const r=E.simulate(p);
  // One day of accrued interest exists on sale and may create a small tax.
  assert.ok(r.direct.totalTax<50);
  assert.equal(r.insurance.benefit,0);
  near(r.direct.net,r.insurance.net);
});
test('five-year condition: a day early is ineligible, anniversary is eligible',()=>{
  for(const [end,eligible]of [['2031-10-18',false],['2031-10-19',true]]){
    const r=E.simulate({...zero,amount:10000000,contracts:1,start:'2026-10-19',end,closeDates:[end]});
    assert.equal(r.insurance.benefit>0,eligible);
  }
});
test('three years must be exceeded for LDV, no coupon exemption',()=>{
  const common={...zero,amount:1000000,start:'2026-10-19',price:80,exitPrice:100,reinvest:false,contracts:1};
  const exact=E.simulate({...common,end:'2029-10-19',closeDates:['2029-10-19']});
  const after=E.simulate({...common,end:'2029-10-20',closeDates:['2029-10-20']});
  assert.equal(exact.direct.ldv,0);assert.ok(after.direct.ldv>0);
  assert.ok(after.direct.totalTax>0,'coupons still taxable');
});
test('same-year insurance payouts cannot multiply the annual exemption',()=>{
  const r=E.simulate({amount:100000000,closeDates:['2041-10-19','2041-10-19','2041-10-19']});
  near(r.insurance.benefit,30000000);
  assert.ok(r.warnings.some(w=>w.includes('общий лимит')));
  assert.ok(r.years.every(y=>y.benefit<=30000000+.01));
});
test('three distinct years can use 90m; post-payout cash is not left inside insurance',()=>{
  const r=E.simulate({});near(r.insurance.benefit,90000000);
  assert.equal(r.contracts.length,3);assert.ok(r.contracts.every(c=>c.payout>0));
  assert.ok(r.contracts.every(c=>c.benefit<=30000000));
  assert.ok(r.audit.some(e=>e.branch==='Контур'&&e.type==='Покупка ОФЗ: брокер'&&e.date==='2039-10-19'));
});
test('annual table and final results reconcile after terminal liquidation',()=>{
  for(const taxRegime of ['current','scenario'])for(const end of ['2029-04-01','2034-10-19','2041-10-19']){
    const r=E.simulate({taxRegime,end,contracts:1,closeDates:[end]});
    near(r.direct.totalTax,r.years.reduce((s,y)=>s+y.directTax,0),1);
    near(r.insurance.totalTax,r.years.reduce((s,y)=>s+y.insuranceTax,0),1);
    near(r.direct.net,r.points.at(-1).direct);
    near(r.insurance.net,r.points.at(-1).insurance);
    assert.equal(r.direct.remainingTax,0);assert.equal(r.insurance.remainingTax,0);
  }
});
test('tax funded by sales is recorded in the sale year; no external cash',()=>{
  const r=E.simulate({});
  assert.ok(r.audit.some(e=>e.branch==='Брокер'&&e.type==='Продажа ОФЗ: брокер'&&e.date.endsWith('01-31')));
  assert.ok(r.audit.some(e=>e.type.startsWith('НДФЛ брокера')));
  assert.ok(r.direct.net>0&&r.insurance.net>0);
});
test('no additional tax on already-taxed coupons after maturity',()=>{
  const common={...zero,amount:1000000,contracts:1,closeDates:['2040-05-16']};
  const a=E.simulate({...common,end:'2040-05-16'});
  const b=E.simulate({...common,end:'2041-10-19'});
  near(a.direct.net,b.direct.net,1);near(a.insurance.net,b.insurance.net,1);
  near(a.direct.totalTax,b.direct.totalTax,1);
});
test('higher expenses reduce insurance result; lower MF improves it',()=>{
  const a=E.simulate({insuranceFee:0}),b=E.simulate({}),c=E.simulate({portfolioFee:1});
  assert.ok(a.insurance.net>b.insurance.net);assert.ok(b.insurance.net>c.insurance.net);
  assert.equal(a.insurance.insuranceFees,0);near(a.direct.net,b.direct.net);
});
test('external same-base income affects FNS aggregation, not asset funding',()=>{
  const a=E.simulate({}),b=E.simulate({otherIncome:30000000});
  assert.ok(b.direct.net<a.direct.net);assert.ok(b.insurance.net<a.insurance.net);
  assert.ok(b.audit.some(e=>e.type.startsWith('Доплата ФНС')&&e.amount>0));
});
test('validation rejects malformed dates, impossible dates and invalid values',()=>{
  for(const input of [{amount:-1},{price:0},{start:'2026-02-30'},{end:'2026-01-01'},
    {contracts:4},{insuranceFee:9},{taxRegime:'made-up'},{closeDates:['2020-01-01','2040-10-19','2041-10-19']}])assert.throws(()=>E.simulate(input));
});

test('cash-flow journal independently reconciles every ruble to final cash',()=>{
  for(const parameters of [{},{taxRegime:'scenario'},
    {amount:5000000,end:'2033-09-01',contracts:1,closeDates:['2033-09-01'],price:130,exitPrice:65,reinvest:false},
    {amount:100000000,closeDates:['2041-10-19','2041-10-19','2041-10-19'],otherIncome:5000000}]){
    const r=E.simulate(parameters);
    for(const [branch,final]of [['Брокер',r.direct],['Контур',r.insurance]]){
      let cash=r.parameters.amount,taxes=0;
      for(const e of r.audit.filter(e=>e.branch===branch)){
        if(e.type.startsWith('Покупка'))cash-=e.amount;
        if(e.type.startsWith('Продажа')||e.type.startsWith('Купон:'))cash+=e.amount;
        if(e.type==='Комиссия Контур')cash-=e.amount;
        if(e.type.startsWith('НДФЛ брокера')||e.type.startsWith('Доплата ФНС')||e.type==='Финальный расчет НДФЛ')taxes+=e.amount;
        // Insurance payout is an internal transfer. Only its withheld PIT leaves the portfolio.
      }
      if(branch==='Контур')taxes+=r.contracts.reduce((v,c)=>v+c.tax,0);
      near(taxes,final.totalTax,.01);
      near(cash-taxes,final.net,.1);
    }
  }
});

test('single purchase with sufficient gain uses 3m times full years, not number of accounts',()=>{
  const r=E.simulate({...zero,amount:1000000000,reinvest:false,price:60,exitPrice:120,
    end:'2039-10-20',contracts:1,closeDates:['2039-10-20']});
  near(r.direct.ldv,39000000);
});
test('broad scenario matrix is finite, annual benefit capped and taxes nonnegative',()=>{
  let cases=0;
  for(const amount of [1,2000000,35000000,50000000])for(const contracts of [1,2,3])for(const taxRegime of ['current','scenario'])for(const pricePath of ['flat','linear'])for(const reinvest of [false,true]){
    const r=E.simulate({amount,contracts,taxRegime,pricePath,reinvest},{audit:false});
    for(const b of [r.direct,r.insurance])for(const k of ['net','totalTax','insuranceFees','tradingFees','ldv','benefit'])assert.ok(Number.isFinite(b[k])&&b[k]>=-.01,`${k}: ${b[k]}`);
    assert.ok(r.years.every(y=>y.benefit<=30000000+.01));
    assert.ok(r.insurance.benefit<=contracts*30000000+.01);cases++;
  }
  assert.equal(cases,96);
});
