/* Calendar cash-flow model. No network, DOM, forecasts or tax-rate guessing. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OfzComparison = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const FACE = 1000;
  const MATURITY = Date.parse('2040-05-16T00:00:00Z');
  // MOEX ISS bondization/SU26248RMFS3, verified 19.10.2026. The first period is long.
  const COUPONS = [
    ['2024-12-04','2024-05-15',68.13],['2025-06-04','2024-12-04',61.08],
    ['2025-12-03','2025-06-04',61.08],['2026-06-03','2025-12-03',61.08],
    ['2026-12-02','2026-06-03',61.08],['2027-06-02','2026-12-02',61.08],
    ['2027-12-01','2027-06-02',61.08],['2028-05-31','2027-12-01',61.08],
    ['2028-11-29','2028-05-31',61.08],['2029-05-30','2028-11-29',61.08],
    ['2029-11-28','2029-05-30',61.08],['2030-05-29','2029-11-28',61.08],
    ['2030-11-27','2030-05-29',61.08],['2031-05-28','2030-11-27',61.08],
    ['2031-11-26','2031-05-28',61.08],['2032-05-26','2031-11-26',61.08],
    ['2032-11-24','2032-05-26',61.08],['2033-05-25','2032-11-24',61.08],
    ['2033-11-23','2033-05-25',61.08],['2034-05-24','2033-11-23',61.08],
    ['2034-11-22','2034-05-24',61.08],['2035-05-23','2034-11-22',61.08],
    ['2035-11-21','2035-05-23',61.08],['2036-05-21','2035-11-21',61.08],
    ['2036-11-19','2036-05-21',61.08],['2037-05-20','2036-11-19',61.08],
    ['2037-11-18','2037-05-20',61.08],['2038-05-19','2037-11-18',61.08],
    ['2038-11-17','2038-05-19',61.08],['2039-05-18','2038-11-17',61.08],
    ['2039-11-16','2039-05-18',61.08],['2040-05-16','2039-11-16',61.08]
  ].map(([date,start,amount]) => ({date: dateMs(date), start:dateMs(start), amount}));
  const couponMap = new Map(COUPONS.map(c => [c.date,c]));
  function dateMs(s) {
    if (typeof s === 'number') return s;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return NaN;
    const t = Date.parse(s+'T00:00:00Z');
    return Number.isFinite(t) && new Date(t).toISOString().slice(0,10) === s ? t : NaN;
  }
  function iso(t) { return new Date(t).toISOString().slice(0,10); }
  function year(t) { return new Date(t).getUTCFullYear(); }
  function utc(y,m,d) { return Date.UTC(y,m,d); }
  function addYears(t,n) {
    const a = new Date(t), y = a.getUTCFullYear()+n, m = a.getUTCMonth();
    return utc(y,m,Math.min(a.getUTCDate(),new Date(utc(y,m+1,0)).getUTCDate()));
  }
  function fullYears(a,b) { let n=year(b)-year(a); if (addYears(a,n)>b) n--; return n; }
  function minInsuranceYears(open) { return Math.max(5,Math.min(10,year(open)-2021)); }
  function accrued(t) {
    if (t>=MATURITY) return 0;
    const c=COUPONS.find(c=>t>=c.start && t<c.date);
    // MOEX quotes accrued coupon to kopecks for one bond.
    return c ? Math.round(FACE*.1225*((t-c.start)/DAY)/365*100)/100 : 0;
  }
  function tax(base,regime='current') {
    const brackets=regime==='scenario' ? [[2400000,.13],[5000000,.15],[20000000,.18],[50000000,.20],[Infinity,.22]] : [[2400000,.13],[Infinity,.15]];
    let result=0,lo=0;
    for(const[hi,rate]of brackets){if(base<=lo)break;result+=(Math.min(base,hi)-lo)*rate;lo=hi;}
    return Math.round(Math.max(0,result));
  }
  function normalize(input) {
    const p={amount:35000000,start:'2026-10-19',end:'2041-10-19',price:80,exitPrice:100,
      pricePath:'linear',insuranceFee:1.5,portfolioFee:0,brokerFee:.05,insuranceTradeFee:.05,
      contracts:3,closeDates:[],taxRegime:'current',ldv:true,reinvest:true,otherIncome:0,...input};
    p.start=dateMs(p.start);p.end=dateMs(p.end);p.closeDates=(p.closeDates||[]).map(dateMs);
    const checks=[['amount',1,1e12],['price',1,200],['exitPrice',1,200],['insuranceFee',0,5],
      ['portfolioFee',0,5],['brokerFee',0,2],['insuranceTradeFee',0,2],['otherIncome',0,1e12]];
    for(const[k,min,max]of checks)if(!Number.isFinite(p[k])||p[k]<min||p[k]>max)throw Error('Недопустимое значение: '+k);
    if(!Number.isFinite(p.start)||!Number.isFinite(p.end)||p.start<dateMs('2025-01-01')||p.start>=MATURITY||p.end<=p.start||p.end>addYears(p.start,20))throw Error('Проверьте даты: начало с 2025 года до погашения; горизонт до 20 лет.');
    if(!Number.isInteger(p.contracts)||p.contracts<1||p.contracts>3)throw Error('Можно выбрать от 1 до 3 договоров.');
    if(!['current','scenario'].includes(p.taxRegime)||!['linear','flat'].includes(p.pricePath))throw Error('Неизвестный режим расчета.');
    if(p.closeDates.length!==p.contracts)p.closeDates=Array.from({length:p.contracts},(_,i)=>addYears(p.end,i-p.contracts+1));
    if(p.closeDates.some(t=>!Number.isFinite(t)||t<=p.start||t>p.end))throw Error('Все выплаты должны быть после начала и не позже конца горизонта.');
    return p;
  }
  function cleanPrice(t,p) {
    if(t>=MATURITY)return FACE;
    const target=p.end>=MATURITY?FACE:p.exitPrice*10;
    if(p.pricePath==='flat')return p.price*10;
    return p.price*10+(target-p.price*10)*(t-p.start)/(Math.min(p.end,MATURITY)-p.start);
  }
  function price(t,p){return cleanPrice(t,p)+accrued(t);}
  function ledger(){return {coupon:0,gain:0,eligible:0,weighted:0,weight:0,ldv:0,base:0,localTax:0,paid:0,extra:0,extraPaid:0,insBase:0,insWithheld:0,benefit:0,insProfit:0,settled:false};}
  function record(s,y){return s.years[y]||(s.years[y]=ledger());}
  function account(cash=0){return {cash,lots:[],tradeFees:0,coupons:0};}
  function units(a){return a.lots.reduce((n,l)=>n+l.n,0);}
  function nav(a,t,p){return a.cash+units(a)*price(t,p);}
  function log(s,t,type,amount,detail){if(s.audit)s.audit.push({date:iso(t),type,amount,detail});}
  function buy(s,a,t,feeRate,isBroker){
    if(t>=MATURITY||a.cash<=0)return;
    const dirty=price(t,s.p),fee=feeRate/100;
    const n=Math.floor((a.cash+1e-8)/(dirty*(1+fee)));
    if(!n)return;
    const cost=n*dirty,commission=cost*fee;
    a.cash-=cost+commission;a.tradeFees+=commission;
    a.lots.push({n,date:t,clean:cleanPrice(t,s.p),nkd:accrued(t),purchaseFee:dirty*fee});
    log(s,t,isBroker?'Покупка ОФЗ: брокер':'Покупка ОФЗ: Контур',cost+commission,n+' облигаций');
  }
  function sell(s,a,n,t,feeRate,isBroker){
    n=Math.min(n,units(a));if(n<=0)return 0;
    const dirty=price(t,s.p),sellFee=dirty*feeRate/100;
    const proceeds=n*(dirty-sellFee);
    let remaining=n;
    const r=record(s,year(t));
    for(const lot of a.lots){
      if(!remaining)break;
      const q=Math.min(remaining,lot.n);if(!q)continue;
      if(isBroker){
        const gain=q*(dirty-sellFee-lot.clean-lot.nkd-lot.purchaseFee);
        r.gain+=gain;
        if(s.p.ldv && gain>0 && t>addYears(lot.date,3)){
          r.eligible+=gain;r.weighted+=q*dirty*fullYears(lot.date,t);r.weight+=q*dirty;
        }
      }
      lot.n-=q;remaining-=q;
    }
    a.lots=a.lots.filter(l=>l.n>0);a.cash+=proceeds;a.tradeFees+=n*sellFee;
    log(s,t,isBroker?'Продажа ОФЗ: брокер':'Продажа ОФЗ: Контур',proceeds,n+' облигаций; ФИФО');
    return proceeds;
  }
  function spend(s,a,amount,t,feeRate,isBroker){
    if(amount<=0)return;
    if(a.cash+1e-7<amount && units(a)>0){
      const per=price(t,s.p)*(1-feeRate/100);
      sell(s,a,Math.ceil((amount-a.cash)/per-1e-10),t,feeRate,isBroker);
    }
    if(a.cash+0.01<amount)throw Error('Недостаточно активов для налога или комиссии. Измените параметры.');
    a.cash=Math.max(0,a.cash-amount);
  }
  function brokerBase(s,y){
    const r=record(s,y),total=Math.max(0,r.coupon+r.gain);
    const cap=r.weight>0?3000000*r.weighted/r.weight:0;
    r.ldv=s.p.ldv?Math.min(r.eligible,cap,total):0;
    r.base=Math.max(0,total-r.ldv);r.localTax=tax(r.base,s.p.taxRegime);
    r.extra=Math.max(0,tax(s.p.otherIncome+r.base+r.insBase,s.p.taxRegime)-tax(s.p.otherIncome,s.p.taxRegime)-r.localTax-r.insWithheld);
    return r;
  }
  function coupon(s,a,t,c,isBroker){
    const n=units(a);if(!n)return;
    const gross=n*c.amount;
    a.cash+=gross;a.coupons+=gross;
    if(isBroker){
      const paidNkd=a.lots.reduce((sum,l)=>sum+l.n*l.nkd,0);
      record(s,year(t)).coupon+=gross-paidNkd;
      a.lots.forEach(l=>{l.nkd=0;});
    }
    log(s,t,isBroker?'Купон: брокер':'Купон: Контур',gross,'НКД покупки учитывается один раз при первом купоне');
  }
  function chargeInsurance(s,a,t){
    if(a.closed||a.accruedFee<=0)return;
    const amount=Math.min(a.accruedFee,nav(a,t,s.p));
    spend(s,a,amount,t,s.p.insuranceTradeFee,false);
    a.charged+=amount;a.accruedFee=0;
    log(s,t,'Комиссия Контур',amount,'Ежедневное начисление, ежемесячное списание');
  }
  function closeInsurance(s,a,t,forced=false){
    if(a.closed)return;
    chargeInsurance(s,a,t);
    sell(s,a,units(a),t,s.p.insuranceTradeFee,false);
    const gross=a.cash,profit=Math.max(0,gross-a.initial),r=record(s,year(t));
    const eligible=t>=addYears(s.p.start,minInsuranceYears(s.p.start));
    const benefit=eligible?Math.min(profit,30000000,Math.max(0,30000000-r.benefit)):0;
    const taxable=Math.max(0,profit-benefit);
    const withheld=tax(r.insBase+taxable,s.p.taxRegime)-tax(r.insBase,s.p.taxRegime);
    r.insBase+=taxable;r.insWithheld+=withheld;r.benefit+=benefit;r.insProfit+=profit;
    a.closed=true;a.closedAt=t;a.cash=0;
    a.payout=gross-withheld;a.benefit=benefit;a.tax=withheld;
    s.broker.cash+=gross-withheld;
    log(s,t,'Выплата Контур',gross-withheld,`${forced?'Условный выход; ':''}договор ${a.id}; льгота ${Math.round(benefit)}; НДФЛ ${withheld}`);
  }
  function state(p,insured,audit){
    const s={p,broker:account(insured?0:p.amount),contracts:[],years:{},audit:audit?[]:null};
    if(insured)s.contracts=Array.from({length:p.contracts},(_,i)=>({...account(p.amount/p.contracts),id:i+1,initial:p.amount/p.contracts,close:p.closeDates[i],closed:false,accruedFee:0,charged:0}));
    buy(s,s.broker,p.start,p.brokerFee,true);
    s.contracts.forEach(a=>buy(s,a,p.start,p.insuranceTradeFee,false));
    return s;
  }
  function totals(s,t){
    let paid=0,due=0,ldv=0,benefit=0;
    for(const key of Object.keys(s.years)){
      const r=brokerBase(s,Number(key));
      paid+=r.paid+r.extraPaid+r.insWithheld;
      due+=Math.max(0,r.localTax-r.paid)+Math.max(0,r.extra-r.extraPaid);
      ldv+=r.ldv;benefit+=r.benefit;
    }
    const insuranceFees=s.contracts.reduce((v,a)=>v+a.charged+a.accruedFee,0);
    const tradingFees=s.broker.tradeFees+s.contracts.reduce((v,a)=>v+a.tradeFees,0);
    const assets=nav(s.broker,t,s.p)+s.contracts.reduce((v,a)=>v+(a.closed?0:nav(a,t,s.p)-a.accruedFee),0);
    return {assets,paid,due,totalTax:paid+due,insuranceFees,tradingFees,fees:insuranceFees+tradingFees,ldv,benefit};
  }
  function liquidation(s,t){
    // Quotes are explicitly after a hypothetical complete exit on this date.
    const copy={...s,broker:{...s.broker,lots:s.broker.lots.map(l=>({...l}))},contracts:s.contracts.map(a=>({...a,lots:a.lots.map(l=>({...l}))})),years:Object.fromEntries(Object.entries(s.years).map(([k,r])=>[k,{...r}])),audit:null};
    copy.contracts.forEach(a=>closeInsurance(copy,a,t,true));
    sell(copy,copy.broker,units(copy.broker),t,copy.p.brokerFee,true);
    const values=totals(copy,t);
    return {...values,net:Math.max(0,values.assets-values.due),remainingTax:values.due};
  }
  function settleTaxes(s,t){
    const d=new Date(t),m=d.getUTCMonth(),day=d.getUTCDate(),previous=year(t)-1;
    const r=s.years[previous];if(!r)return;
    if(m===0&&day===31){
      const amount=Math.max(0,r.localTax-r.paid);
      spend(s,s.broker,amount,t,s.p.brokerFee,true);r.paid+=amount;
      log(s,t,'НДФЛ брокера за '+previous,amount,'Расчетная дата удержания 31 января; продажи для налога относятся к новому году');
    }
    if(m===11&&day===1){
      const amount=Math.max(0,r.extra-r.extraPaid);
      spend(s,s.broker,amount,t,s.p.brokerFee,true);r.extraPaid+=amount;
      log(s,t,'Доплата ФНС за '+previous,amount,'Агрегация доходов брокера, страховщика и заданных прочих доходов');
    }
  }
  function step(s,t){
    const p=s.p,c=couponMap.get(t),d=new Date(t),monthEnd=new Date(t+DAY).getUTCMonth()!==d.getUTCMonth();
    if(c){coupon(s,s.broker,t,c,true);s.contracts.filter(a=>!a.closed).forEach(a=>coupon(s,a,t,c,false));}
    if(t===MATURITY){
      sell(s,s.broker,units(s.broker),t,0,true);
      s.contracts.filter(a=>!a.closed).forEach(a=>sell(s,a,units(a),t,0,false));
      log(s,t,'Погашение ОФЗ 26248',0,'Номинал 1000 ₽; после погашения деньги не приносят доход');
    }
    for(const a of s.contracts)if(!a.closed){
      a.accruedFee+=nav(a,t,p)*(p.insuranceFee+p.portfolioFee)/100/365;
      if(monthEnd||t===a.close)chargeInsurance(s,a,t);
    }
    settleTaxes(s,t);
    let payout=false;
    for(const a of s.contracts)if(!a.closed&&t===a.close){closeInsurance(s,a,t);payout=true;}
    if(p.reinvest&&(c||payout)){
      buy(s,s.broker,t,p.brokerFee,true);
      s.contracts.filter(a=>!a.closed).forEach(a=>buy(s,a,t,p.insuranceTradeFee,false));
    }
    if(d.getUTCMonth()===11&&d.getUTCDate()===31){const r=brokerBase(s,year(t));r.settled=true;}
  }
  function finalize(s,t){
    s.contracts.forEach(a=>closeInsurance(s,a,t,true));
    sell(s,s.broker,units(s.broker),t,s.p.brokerFee,true);
    const before=totals(s,t);
    spend(s,s.broker,before.due,t,s.p.brokerFee,true);
    if(before.due>0)log(s,t,'Финальный расчет НДФЛ',before.due,'Полный выход: включая резерв обязательств, срок уплаты которых еще не наступил');
    for(const r of Object.values(s.years)){r.paid=r.localTax;r.extraPaid=r.extra;}
    const values=totals(s,t);
    return {...values,net:values.assets,remainingTax:0};
  }
  function simulate(input,{audit=true}={}){
    const p=normalize(input),direct=state(p,false,audit),insured=state(p,true,audit),points=[];
    function point(t){
      const a=liquidation(direct,t),b=liquidation(insured,t);
      points.push({date:iso(t),time:t,direct:a.net,insurance:b.net,directAssets:totals(direct,t).assets,insuranceAssets:totals(insured,t).assets,directTax:a.totalTax,insuranceTax:b.totalTax,insuranceFee:b.insuranceFees,benefit:b.benefit});
    }
    point(p.start);
    for(let t=p.start+DAY;t<=p.end;t+=DAY){
      step(direct,t);step(insured,t);
      const d=new Date(t),next=new Date(t+DAY);
      if(next.getUTCMonth()!==d.getUTCMonth()||p.closeDates.includes(t)||t===MATURITY||t===p.end)point(t);
    }
    const a=finalize(direct,p.end),b=finalize(insured,p.end);
    Object.assign(points[points.length-1],{direct:a.net,insurance:b.net,directTax:a.totalTax,insuranceTax:b.totalTax,benefit:b.benefit});
    const warnings=[];
    if(p.end>MATURITY)warnings.push('ОФЗ погашается 16.05.2040. После погашения деньги в обеих ветках лежат без дохода, комиссия открытых договоров продолжает начисляться.');
    const counts={};for(const t of p.closeDates)counts[year(t)]=(counts[year(t)]||0)+1;
    if(Object.values(counts).some(n=>n>1))warnings.push('Несколько договоров выплачиваются в одном году: общий лимит страховой льготы 30 млн ₽ за этот год, не 30 млн ₽ × число договоров.');
    if(p.closeDates.some(t=>t<addYears(p.start,minInsuranceYears(p.start))))warnings.push('Есть выплата до минимального срока. По соответствующему договору освобождение прибыли не применяется. Частичные выплаты до этих дат не моделируются.');
    if(p.taxRegime==='scenario')warnings.push('13–22% — гипотетический сценарий, не действующая шкала для этих доходов. Будущие законы неизвестны.');
    const years=Array.from(new Set([...Object.keys(direct.years),...Object.keys(insured.years)])).sort().map(y=>{
      const da=brokerBase(direct,Number(y)),ib=brokerBase(insured,Number(y));
      return {year:Number(y),directCoupon:da.coupon,directGain:da.gain,directLdv:da.ldv,directTax:da.localTax+da.extra,
        insuranceProfit:ib.insProfit,benefit:ib.benefit,insuranceTax:ib.insWithheld+ib.localTax+ib.extra};
    });
    return {parameters:{...p,start:iso(p.start),end:iso(p.end),closeDates:p.closeDates.map(iso)},direct:a,insurance:b,difference:b.net-a.net,
      points,years,warnings,contracts:insured.contracts.map(c=>({id:c.id,date:iso(c.close),payout:c.payout||0,benefit:c.benefit||0,tax:c.tax||0})),
      audit:[...(direct.audit||[]).map(e=>({...e,branch:'Брокер'})),...(insured.audit||[]).map(e=>({...e,branch:'Контур'}))].sort((a,b)=>a.date.localeCompare(b.date))};
  }
  return {simulate,normalize,tax,accrued,fullYears,minInsuranceYears,addYears,iso,dateMs,cleanPrice,COUPONS,FACE,MATURITY};
});
