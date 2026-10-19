(() => {
  'use strict';
  const root=document.getElementById('ofz-comparison');
  if(!root||!window.OfzComparison)return;
  const E=window.OfzComparison;
  const $=id=>document.getElementById(id);
  const money=new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0});
  const date=new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'});
  const shortMoney=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n/1000000)+' млн';
  const parse=s=>Number(String(s).replace(/[\s\u00a0\u202f]/g,'').replace(',','.'));
  const closeInputs=[1,2,3].map(i=>$('ofz-close-'+i));
  let result=null,timer,selected=0,chartGeometry;
  function syncDates(reset=false){
    const count=Number($('ofz-count').value),end=E.dateMs($('ofz-end').value),start=$('ofz-start').value;
    closeInputs.forEach((el,i)=>{
      el.parentElement.hidden=i>=count;el.disabled=i>=count;el.min=start;el.max=$('ofz-end').value;
      if(reset&&Number.isFinite(end))el.value=E.iso(E.addYears(end,i-count+1));
    });
    const matured=end>=E.MATURITY;
    $('ofz-exit-price').disabled=matured||$('ofz-path').value==='flat';
    $('ofz-exit-hint').textContent=matured?'На 16.05.2040 погашение по 100% номинала. После этой даты доход на деньги равен нулю.':$('ofz-path').value==='flat'?'Цена постоянна до горизонта. Для отдельной цены выхода выберите плавную траекторию.':'Предположение о цене, не прогноз. НКД на дату выхода добавляется отдельно.';
  }
  function input(){
    return {amount:parse($('ofz-amount').value),start:$('ofz-start').value,end:$('ofz-end').value,
      price:parse($('ofz-price').value),exitPrice:parse($('ofz-exit-price').value),pricePath:$('ofz-path').value,
      insuranceFee:parse($('ofz-fee').value),portfolioFee:parse($('ofz-portfolio-fee').value),
      brokerFee:parse($('ofz-broker-fee').value),insuranceTradeFee:parse($('ofz-trade-fee').value),
      contracts:Number($('ofz-count').value),closeDates:closeInputs.filter(el=>!el.disabled).map(el=>el.value),
      taxRegime:$('ofz-tax').value,ldv:$('ofz-ldv').checked,reinvest:$('ofz-reinvest').checked,otherIncome:parse($('ofz-other-income').value)};
  }
  function set(id,value){$(id).textContent=value;}
  function calculate(){
    clearTimeout(timer);syncDates();
    $('ofz-output').setAttribute('aria-busy','true');
    try{
      const r=E.simulate(input());result=r;
      const nkd=E.accrued(E.dateMs(r.parameters.start));
      const exactMoney=new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
      set('ofz-bond-info',`На дату покупки: чистая цена ${exactMoney.format(r.parameters.price*10)} ₽ + НКД ${exactMoney.format(nkd)} ₽ = ${exactMoney.format(r.parameters.price*10+nkd)} ₽ за облигацию до комиссии. Купон 12,25% от номинала - не доходность к погашению.`);
      $('ofz-input-error').hidden=true;$('ofz-output').hidden=false;
      const a=r.direct,b=r.insurance;
      for(const[id,value]of Object.entries({
        'ofz-direct-net':a.net,'ofz-direct-tax':a.totalTax,'ofz-direct-fees':a.tradingFees,'ofz-direct-ldv':a.ldv,
        'ofz-insurance-net':b.net,'ofz-insurance-tax':b.totalTax,'ofz-insurance-fees':b.insuranceFees,
        'ofz-insurance-trades':b.tradingFees,'ofz-used-benefit':b.benefit
      }))set(id,money.format(value));
      const close=Math.abs(r.difference)<Math.max(a.net,b.net)*.001;
      set('ofz-winner-label',close?'Результаты близки в пределах 0,1%':r.difference>0?'Преимущество ветки «Контур»':'Преимущество прямого владения');
      set('ofz-difference',money.format(Math.abs(r.difference)));
      set('ofz-verdict-note',`На ${date.format(E.dateMs(r.parameters.end))}. Шкала ${r.parameters.taxRegime==='current'?'13 / 15%':'13–22% (гипотеза)'}. Налоги профинансированы из активов, а не внешними деньгами. Разница не является гарантией будущей выгоды.`);
      $('ofz-warnings').replaceChildren(...r.warnings.map(w=>{const el=document.createElement('p');el.textContent=w;return el;}));
      $('ofz-year-rows').replaceChildren(...r.years.map(y=>{
        const tr=document.createElement('tr');
        for(const val of [y.year,...['directCoupon','directLdv','directTax','benefit','insuranceTax'].map(k=>money.format(y[k]))]){
          const td=document.createElement('td');td.textContent=String(val);tr.append(td);
        }return tr;
      }));
      $('ofz-cursor').max=String(r.points.length-1);selected=r.points.length-1;$('ofz-cursor').value=String(selected);
      drawChart();
    }catch(error){
      set('ofz-bond-info','');
      $('ofz-input-error').textContent=error.message||'Проверьте параметры расчета.';
      $('ofz-input-error').hidden=false;$('ofz-output').hidden=true;result=null;
    }finally{$('ofz-output').setAttribute('aria-busy','false');}
  }
  function drawChart(){
    if(!result)return;
    const host=$('ofz-chart'),width=Math.max(280,Math.round(host.clientWidth)),height=width<600?280:340;
    const left=width<600?53:68,right=15,top=18,bottom=37;
    const mode=$('ofz-chart-mode').value,dk=mode==='net'?'direct':'directAssets',ik=mode==='net'?'insurance':'insuranceAssets';
    const points=result.points,max=Math.max(1,...points.flatMap(p=>[p[dk],p[ik]]))*1.08;
    const start=points[0].time,end=points[points.length-1].time;
    const x=t=>left+(t-start)/(end-start)*(width-left-right),y=v=>height-bottom-v/max*(height-top-bottom);
    let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" aria-hidden="true">`;
    for(let i=0;i<=4;i++){
      const value=max*i/4,py=y(value);
      svg+=`<line x1="${left}" y1="${py}" x2="${width-right}" y2="${py}" stroke="#e6ebf3"/><text x="${left-9}" y="${py+4}" text-anchor="end" fill="#66738a" font-family="Segoe UI,sans-serif" font-size="11">${shortMoney(value)}</text>`;
    }
    for(let i=0;i<=3;i++){
      const t=start+(end-start)*i/3,px=x(t);
      svg+=`<text x="${px}" y="${height-11}" text-anchor="${i===0?'start':i===3?'end':'middle'}" fill="#66738a" font-family="Segoe UI,sans-serif" font-size="11">${new Date(t).getUTCFullYear()}</text>`;
    }
    for(const[key,color]of [[dk,'#2658d8'],[ik,'#0c9177']]){
      const d=points.map((p,i)=>`${i?'L':'M'}${x(p.time).toFixed(2)},${y(p[key]).toFixed(2)}`).join(' ');
      svg+=`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.7" stroke-linejoin="round"/>`;
    }
    const p=points[selected];
    svg+=`<line x1="${x(p.time)}" y1="${top}" x2="${x(p.time)}" y2="${height-bottom}" stroke="#7d8ca2" stroke-dasharray="4 4"/>`;
    for(const[key,color]of [[dk,'#2658d8'],[ik,'#0c9177']])svg+=`<circle cx="${x(p.time)}" cy="${y(p[key])}" r="4.5" fill="${color}" stroke="white" stroke-width="2"/>`;
    host.innerHTML=svg+'</svg>';
    chartGeometry={left,right,width,start,end};
    const readout=$('ofz-chart-readout');readout.replaceChildren();
    for(const[cl,text]of [['date',date.format(p.time)],['broker','Брокер: '+money.format(p[dk])],['insurance','Контур: '+money.format(p[ik])]]){
      const span=document.createElement('span');span.className=cl;span.textContent=text;readout.append(span);
    }
  }
  $('ofz-chart').addEventListener('pointermove',event=>{
    if(!result||!chartGeometry||(event.pointerType==='touch'&&event.buttons===0))return;
    const rect=$('ofz-chart').getBoundingClientRect(),g=chartGeometry;
    const ratio=Math.max(0,Math.min(1,(event.clientX-rect.left-g.left)/(g.width-g.left-g.right)));
    const t=g.start+ratio*(g.end-g.start);
    selected=result.points.reduce((best,p,i)=>Math.abs(p.time-t)<Math.abs(result.points[best].time-t)?i:best,0);
    $('ofz-cursor').value=String(selected);drawChart();
  });
  $('ofz-cursor').addEventListener('input',()=>{selected=Number($('ofz-cursor').value);drawChart();});
  $('ofz-chart-mode').addEventListener('change',drawChart);
  $('ofz-form').addEventListener('submit',event=>{event.preventDefault();calculate();});
  $('ofz-form').addEventListener('input',event=>{
    if(event.target.type==='date'||event.target.type==='checkbox'||event.target.tagName==='SELECT')return;
    clearTimeout(timer);timer=setTimeout(calculate,350);
  });
  $('ofz-form').addEventListener('change',event=>{
    if(['ofz-count','ofz-start','ofz-end'].includes(event.target.id))syncDates(true);
    calculate();
  });
  $('ofz-copy-main').addEventListener('click',()=>{
    $('ofz-amount').value=$('amount').value;
    $('ofz-fee').value=$('insurance-fee').value;
    calculate();
  });
  $('ofz-until-maturity').addEventListener('click',()=>{
    $('ofz-end').value=E.iso(E.MATURITY);syncDates(true);calculate();
  });
  $('ofz-export').addEventListener('click',()=>{
    if(!result)return;
    const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const rows=[['Параметр','Значение'],...Object.entries(result.parameters).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v]),[],
      ['Дата','Ветка','Событие','Сумма, ₽','Пояснение'],...result.audit.map(e=>[e.date,e.branch,e.type,e.amount.toFixed(2),e.detail]),[],
      ['Год','Купоны, база брокера','Результат продаж брокера','ЛДВ','НДФЛ прямого владения','Прибыль страховых выплат','Льгота страховки','НДФЛ ветки Контур'],
      ...result.years.map(y=>[y.year,y.directCoupon,y.directGain,y.directLdv,y.directTax,y.insuranceProfit,y.benefit,y.insuranceTax]),[],
      ['Итог брокер, после всех налогов',result.direct.net],['Итог Контур, после всех налогов',result.insurance.net],
      ['Налог брокера, включая финальный расчет',result.direct.totalTax],['Налог Контур, включая финальный расчет',result.insurance.totalTax],
      ['Важно','Журнал отражает модель, а не отчет налогового агента; финальный налог включает еще не наступившие обязательства.']];
    const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(esc).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='kontur-ofz-cashflows.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>drawChart()).observe($('ofz-chart'));
  syncDates();calculate();
})();
