'use strict';
const Results=(()=>{
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function summary(d){
  const n=d.completed,total=d.histogram.reduce((sum,count,i)=>sum+count*i,0);
  return {n,mean:n?total/n:null,reversals:d.nonmonotonic};
 }
 function bar(label,count,total,display){
  const width=total?Math.max(0,Math.min(100,count/total*100)):0;
  return `<div class="stat-bar"><span>${esc(label)}</span><div class="stat-track"><i style="width:${width}%"></i></div><strong>${esc(display)}</strong></div>`;
 }
 function expectedValue(payoffs,row,choice){
  const weighted=o=>row*payoffs[o][0]+(10-row)*payoffs[o][1];
  const value=weighted(choice),other=weighted(choice==='A'?'B':'A');
  return {rank:value>other?'higher':value<other?'lower':'equal',value:value/1000,other:other/1000};
 }
 function expectations(d){
  const n=d.completed;
  if(!n)return {rows:[],groupEV:null,expectedTotal:null,expectedPerStudent:null};
  const rows=d.a_counts.map((aCount,i)=>{
   const row=i+1,aEV=expectedValue(d.session.payoffs,row,'A').value,bEV=expectedValue(d.session.payoffs,row,'B').value,bCount=n-aCount;
   return {row,high:row*10,low:100-row*10,aEV,bEV,aCount,bCount,groupEV:(aCount*aEV+bCount*bEV)/n};
  });
  const groupEV=rows.reduce((sum,row)=>sum+row.groupEV,0)/rows.length;
  return {rows,groupEV,expectedTotal:n>=2?2*groupEV:null,expectedPerStudent:n>=2?2*groupEV/n:null};
 }
 function participantEV(choices,payoffs){return choices.reduce((sum,c,i)=>sum+expectedValue(payoffs,i+1,c).value,0)/choices.length;}
 function answer(choice,index,payoffs){
  const ev=expectedValue(payoffs,index+1,choice),label=`${choice}: ${ev.rank} expected value (CHF ${ev.value.toFixed(2)} vs CHF ${ev.other.toFixed(2)})`;
  return `<td><span class="answer answer-${ev.rank}" title="${esc(label)}" aria-label="${esc(label)}">${esc(choice)}<small>${ev.value.toFixed(2)}</small></span></td>`;
 }
 function decisionTable(d,ev){
  const n=d.completed,payoffs=d.session.payoffs;
  const option=(r,o)=>{
   const value=o==='A'?r.aEV:r.bEV,count=o==='A'?r.aCount:r.bCount,rank=expectedValue(payoffs,r.row,o).rank;
   return `<td><span class="ev-formula">${r.high}% × ${(payoffs[o][0]/100).toFixed(2)} + ${r.low}% × ${(payoffs[o][1]/100).toFixed(2)}</span><strong class="ev-value answer-${rank}">${value.toFixed(2)}</strong><span class="ev-count">${count} / ${n} students · ${Math.round(count/n*100)}%</span></td>`;
  };
  return `<section class="decision-explanation"><h3>Decisions &amp; expected values</h3><p class="small muted">EV = probability × payoff, summed across outcomes. All amounts in CHF.</p><div class="table-scroll" tabindex="0" role="region" aria-label="Expected values for all ten decisions"><table class="results-table ev-table"><thead><tr><th scope="col">Row</th><th scope="col">Option A</th><th scope="col">Option B</th><th scope="col">Group EV</th></tr></thead><tbody>${ev.rows.map(r=>`<tr><th scope="row">${r.row}</th>${option(r,'A')}${option(r,'B')}<td><strong class="ev-group-value">${r.groupEV.toFixed(2)}</strong><span class="ev-formula">${r.aCount}/${n} × ${r.aEV.toFixed(2)} + ${r.bCount}/${n} × ${r.bEV.toFixed(2)}</span></td></tr>`).join('')}</tbody><tfoot><tr><th scope="row" colspan="3">Average across all 10 rows</th><td><strong>${ev.groupEV.toFixed(2)}</strong></td></tr></tfoot></table></div><p class="small muted stats-note">Each row’s group EV weights A and B by how many students chose them.</p></section>`;
 }
 function renderDetails(d){
  const s=summary(d),people=d.participants.filter(p=>p.joined||p.submitted);
  if(!s.n)return '<h2>Results</h2><p class="muted">No completed submissions.</p>';
  const ev=expectations(d);
  const rows=people.map(p=>`<tr><th scope="row">${esc(p.name||p.ticket)}</th>${p.choices?p.choices.map((c,i)=>answer(c,i,d.session.payoffs)).join(''):`<td colspan="10" class="muted">Not submitted</td>`}<td>${p.summary?.a_count??'—'}</td><td>${p.choices?participantEV(p.choices,d.session.payoffs).toFixed(2):'—'}</td></tr>`).join('');
  const paymentNote=ev.expectedTotal===null?'At least two submissions are needed for payment expectations.':`${d.session.mode==='practice'?'Practice, before the draw: ':'Before the draw (2 winners): '}expected total CHF ${ev.expectedTotal.toFixed(2)} · expected per student CHF ${ev.expectedPerStudent.toFixed(2)} (selection chance 2/${s.n}).`;
  return `<h2>Results</h2><div class="result-metrics"><div><strong>${s.n}</strong><span>Submitted</span></div><div><strong>CHF ${ev.groupEV.toFixed(2)}</strong><span>Group average EV · if selected</span></div><div><strong>${s.mean.toFixed(1)} / 10</strong><span>Average A choices</span></div><div><strong>${s.reversals}</strong><span>Switched back to A</span></div></div><p class="small muted ev-explanation">Group average EV is the mean of all completed students’ choice EVs. Each student has equal weight; each of the 10 rows has a 10% chance of being paid.</p><p class="small muted ev-payment">${paymentNote}</p>${decisionTable(d,ev)}<h3>Individual choices</h3><p class="ev-legend"><span class="answer-higher">Higher expected value</span><span class="answer-lower">Lower expected value</span></p><p class="small muted">EV in CHF appears below each choice. Mean EV gives each row equal weight.</p><div class="table-scroll" tabindex="0" role="region" aria-label="Individual choices and expected values"><table class="results-table choice-results"><thead><tr><th scope="col">Name</th>${Array.from({length:10},(_,i)=>`<th scope="col">${i+1}</th>`).join('')}<th scope="col">A total</th><th scope="col">Mean EV</th></tr></thead><tbody>${rows}</tbody></table></div><p class="small muted stats-note">Statistics use completed submissions only.</p>`;
 }

 function render(d){
  if(!d.completed)return '<p class="muted">No completed submissions.</p>';
  const ev=expectations(d),n=d.completed;
  const bars=ev.rows.map(r=>{
   const a=r.aCount/n*100,b=100-a,aRank=expectedValue(d.session.payoffs,r.row,'A').rank,bRank=expectedValue(d.session.payoffs,r.row,'B').rank;
   const label=`Row ${r.row}: A ${Math.round(a)}%, B ${Math.round(b)}%. EV A CHF ${r.aEV.toFixed(2)}, EV B CHF ${r.bEV.toFixed(2)}.`;
   return `<div class="projector-row"><span class="row-number">${r.row}</span><strong>${Math.round(a)}%</strong><div class="split-bar" role="img" aria-label="${esc(label)}" title="${esc(label)}"><i class="split-${aRank}" style="width:${a}%"></i><i class="split-${bRank}" style="width:${b}%"></i></div><strong>${Math.round(b)}%</strong></div>`;
  }).join('');
  return `<aside class="ev-spotlight"><span>Class average EV</span><strong><small>CHF</small> ${ev.groupEV.toFixed(2)}</strong><span class="ev-qualifier">if selected</span></aside><section class="projector-chart"><div class="projector-chart-title"><h2>Class choices</h2><span>${n} students${d.session.mode==='practice'?' · Practice':''}</span></div><p class="projector-legend"><span><i class="split-higher"></i>Higher EV</span><span><i class="split-lower"></i>Lower EV</span></p><div class="projector-columns"><span>Row</span><span>A</span><span></span><span>B</span></div>${bars}</section><details class="result-details"><summary>Details</summary><div class="detailed-results">${renderDetails(d)}</div></details>`;
 }
 return {summary,render,expectedValue,expectations,participantEV};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=Results;
