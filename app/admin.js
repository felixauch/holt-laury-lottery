'use strict';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money=n=>'CHF '+(n/100).toFixed(2);
let csrf='',current=null,currentId='',signedIn=false,busy=false,lastLoadedId='',resultsKey='',lastPresentationState='';
async function api(action,data){const r=await fetch('api.php?action='+action,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},body:data?JSON.stringify(data):undefined,cache:'no-store'});let j;try{j=await r.json();}catch{throw Error('Connection problem. Please try again.');}if(!r.ok||j.error){if(r.status===401&&action!=='login')displayLogin(true);throw Error(j.error||'Please try again.');}return j;}
function error(e){$('#error').textContent=e?.message||'';$('#error').hidden=!e;}
function displayLogin(show){signedIn=!show;$('#login').hidden=!show;$('#dashboard').hidden=show;$('#logout').hidden=show;}
function winners(s){return `<div class="winner-grid">${s.winners.map(w=>`<div class="winner"><strong>${esc(w.name||w.ticket)}</strong><div class="payment">${money(w.cents)}</div><p>Row ${w.row} · ${w.choice} · ${w.die<=w.row?'high':'low'} outcome</p></div>`).join('')}</div><p class="small muted">${s.mode==='practice'?'Practice — no payments.':'Total to pay: '+money(s.winners.reduce((a,w)=>a+w.cents,0))}</p>`;}
function presentationState(state){
 $('#dashboard').dataset.phase=state;
 const key=currentId+':'+state;
 if(key!==lastPresentationState){$('#session-controls').open=state==='open'||state==='empty';lastPresentationState=key;}
}
async function refresh(){
 if(busy||!signedIn)return;
 try{
  const list=await api('sessions');currentId=list.active_id||'';
  $('#sessions').innerHTML=list.sessions.filter(s=>s.id!==currentId).map(s=>`<button data-id="${esc(s.id)}">${esc(s.title)} · ${s.completed} submitted${s.mode==='practice'?' · Practice':''}</button>`).join('')||'<p class="small muted">None yet.</p>';
  $('#sessions').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>archive(b.dataset.id)));
  if(!currentId){current=null;presentationState('empty');$('#presentation').hidden=true;$('#session-label').textContent='No session yet.';$('#counts').textContent='0 submitted · 0 joined';$('#status').textContent='Start a session to let students join.';$('#reset').textContent='Start session';$('#finish').hidden=true;$('#close').hidden=true;$('#reopen').hidden=true;$('#winners').hidden=true;$('#results').hidden=true;$('#payment-limit').textContent='2 students · CHF 0.20–7.70 each · CHF 15.40 maximum';$('#export').hidden=true;return;}
  current=await api('details&id='+encodeURIComponent(currentId));const s=current.session,joined=current.participants.filter(p=>p.joined).length;
  $('#session-label').textContent=(s.mode==='practice'?'Practice · ':'')+s.title;$('#counts').textContent=`${current.completed} submitted · ${joined} joined`;$('#reset').textContent='Reset session';if(lastLoadedId!==currentId){$('#practice').checked=s.mode==='practice';lastLoadedId=currentId;}$('#close').hidden=s.state!=='open';$('#close').disabled=current.completed<2;$('#reopen').hidden=s.state!=='closed';$('#finish').hidden=s.state!=='closed';$('#finish').disabled=current.completed<2;const amounts=Object.values(s.payoffs).flat();$('#payment-limit').textContent='2 students · '+money(Math.min(...amounts))+'–'+money(Math.max(...amounts)).replace('CHF ','')+' each · '+money(2*Math.max(...amounts))+' maximum';
  $('#status').textContent=s.state==='drawn'?'Draw complete.':s.state==='closed'?'Submissions closed.':current.completed<2?'Waiting for students.':'Ready when you are.';
  $('#winners').hidden=s.state!=='drawn';if(s.state==='drawn')$('#winners').innerHTML=winners(s);
  $('#export').hidden=false;$('#export').href='api.php?action=export&id='+encodeURIComponent(currentId);
  presentationState(s.state);const showResults=s.state!=='open';$('#presentation').hidden=!showResults;$('#results').hidden=!showResults;const key=JSON.stringify(current);if(showResults&&key!==resultsKey){$('#results').innerHTML=Results.render(current);resultsKey=key;}if(!showResults){$('#results').innerHTML='';resultsKey='';}error(null);
 }catch(e){error(e);}
}
async function archive(id){try{const d=await api('details&id='+encodeURIComponent(id));$('#archive-title').textContent=d.session.title;$('#archive-body').innerHTML=`<p>${d.completed} submitted · ${d.session.mode==='practice'?'Practice':'Real payments'}</p>`+(d.session.state==='drawn'?winners(d.session):'<p class="muted">No draw recorded.</p>')+(d.session.state!=='open'?'<section class="class-results">'+Results.render(d)+'</section>':'');$('#archive-export').href='api.php?action=export&id='+encodeURIComponent(id);$('#archive-dialog').showModal();}catch(e){error(e);}}
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();e.submitter.disabled=true;try{const j=await api('login',{key:$('#key').value});csrf=j.csrf;$('#key').value='';displayLogin(false);await refresh();}catch(e){error(e);}finally{e.submitter.disabled=false;}});
$('#logout').addEventListener('click',async()=>{try{await api('logout',{});displayLogin(true);current=null;currentId='';}catch(e){error(e);}});
async function reset(){if(busy)return;busy=true;$('#reset-confirm').disabled=true;$('#reset').disabled=true;try{await api('create',{mode:$('#practice').checked?'practice':'real'});$('#reset-dialog').close();error(null);}catch(e){error(e);}finally{busy=false;$('#reset-confirm').disabled=false;$('#reset').disabled=false;await refresh();}}
$('#reset').addEventListener('click',()=>current?$('#reset-dialog').showModal():reset());$('#reset-confirm').addEventListener('click',reset);$('#reset-cancel').addEventListener('click',()=>$('#reset-dialog').close());
async function finish(){
 if(busy)return;busy=true;$('#close').disabled=true;$('#finish').disabled=true;$('#reset').disabled=true;
 let failure=null;
 try{await api('finish',{id:currentId});}catch(e){failure=e;}
 finally{busy=false;$('#reset').disabled=false;await refresh();}
 if(failure)error(failure);
 else if(current?.session.state==='drawn')$('#presentation').scrollIntoView({behavior:'smooth',block:'start'});
}
$('#close').addEventListener('click',finish);$('#finish').addEventListener('click',finish);
$('#reopen').addEventListener('click',async()=>{if(busy)return;busy=true;$('#reopen').disabled=true;let failure=null;try{await api('phase',{id:currentId,state:'open'});}catch(e){failure=e;}finally{busy=false;$('#reopen').disabled=false;await refresh();}if(failure)error(failure);});
$('#archive-close').addEventListener('click',()=>$('#archive-dialog').close());
(async()=>{try{const j=await api('state');csrf=j.csrf;displayLogin(!j.admin);if(j.admin)await refresh();}catch(e){error(e);}})();
setInterval(()=>{if(!document.hidden&&!$('#reset-dialog').open)refresh();},5000);
