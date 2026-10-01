'use strict';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money=n=>'CHF '+(n/100).toFixed(2),amount=n=>(n/100).toFixed(2);
let csrf='',participant=null,joinSession=null,activeId='',targetId=new URL(location.href).searchParams.get('session')||'',busy=false,revision=0;
const remember=(id,ticket)=>{try{localStorage.setItem('hl-entry-'+id,ticket);}catch{}};
const savedTicket=id=>{try{return localStorage.getItem('hl-entry-'+id)||'';}catch{return '';}};
async function api(action,data){const r=await fetch('api.php?action='+action,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},body:data?JSON.stringify({...data,protocol:2}):undefined,cache:'no-store'});let j;try{j=await r.json();}catch{throw Error('Connection problem. Please try again.');}if(!r.ok||j.error)throw Error(j.error||'Please try again.');return j;}
function message(selector,text=''){const e=$(selector);e.textContent=text;e.hidden=!text;}
function choices(){return Array.from({length:10},(_,i)=>$(`input[name="choice${i+1}"]:checked`)?.value||null);}
function progress(){$('#progress').textContent=choices().filter(Boolean).length+' / 10';}
function buildChoices(){
 $('#choices').innerHTML=Array.from({length:10},(_,i)=>{const n=i+1,high=n*10,low=100-high;return `<tr><td class="chance">${high}% / ${low}%</td>${['A','B'].map(o=>`<td><label class="choice-option"><input type="radio" name="choice${n}" value="${o}" aria-label="Decision ${n}, ${o}: ${high}% chance of CHF ${amount(participant.payoffs[o][0])}, ${low}% chance of CHF ${amount(participant.payoffs[o][1])}"><span>${o}</span></label></td>`).join('')}</tr>`;}).join('');
 try{const draft=JSON.parse(localStorage.getItem('hl-draft-'+participant.ticket)||'[]');draft.forEach((v,i)=>{if(i<10&&['A','B'].includes(v))$(`input[name="choice${i+1}"][value="${v}"]`).checked=true;});}catch{}progress();
}
function renderJoin(){
 $('#join').hidden=false;$('#experiment').hidden=true;
 const open=joinSession?.state==='open'&&joinSession.enrollment==='name';$('#join-form').hidden=!open;
 $('#room-status').textContent=open?(joinSession.mode==='practice'?'Practice · no payments':'About 2 minutes.'):joinSession?'This session is closed.':'Waiting for your instructor.';
}
function render(p){
 const changed=participant?.ticket!==p?.ticket;participant=p;
 if(!p){renderJoin();return;}
 remember(p.class_id,p.ticket);targetId=p.class_id;history.replaceState(null,'','?session='+encodeURIComponent(targetId));
 $('#join').hidden=true;$('#experiment').hidden=false;$('#participant-name').textContent=p.name;$('#mode').textContent=p.mode==='practice'?'Practice · no payments':'';
 $('#practice-next').hidden=p.mode!=='practice';$('#new-session').hidden=!activeId||activeId===p.class_id;
 const values=Object.values(p.payoffs).flat();$('#payment-range').textContent='CHF '+amount(Math.min(...values))+'–'+amount(Math.max(...values));for(const o of ['A','B'])$('#payoffs-'+o.toLowerCase()).textContent='CHF '+amount(p.payoffs[o][0])+' / '+amount(p.payoffs[o][1]);
 if(changed)buildChoices();
 const done=!!p.submitted;$('#decision-section').hidden=done||p.state!=='open';$('#receipt').hidden=!done&&p.state==='open';
 if(!done&&p.state!=='open'){$('#receipt').innerHTML='<h1>Session closed</h1><p>Your choices were not submitted.</p>';return;}
 if(!done)return;
 try{localStorage.removeItem('hl-draft-'+p.ticket);}catch{}
 let html;
 if(p.state!=='drawn')html=p.state==='closed'&&activeId!==p.class_id?'<h1>Session ended</h1><p>Your choices are saved.</p>':'<h1>Submitted ✓</h1><p>Wait for the draw.</p>';
 else if(p.winner){const w=p.winner;html=`<h1>${p.mode==='practice'?'Practice result':'You were selected'}</h1><p class="payment">${money(w.cents)}</p><p>${p.mode==='practice'?'No payment in practice mode.':'Show this screen to your instructor.'}</p><p class="small muted">Choice ${w.row} · ${w.choice} · ${w.die<=w.row?'high':'low'} outcome</p>`;}
 else html='<h1>Thank you</h1><p>You were not selected. Payment: CHF 0.</p>';
 $('#receipt').innerHTML=html+`<details><summary>Your choices</summary><p class="receipt-choices">${p.choices.map(esc).join(' ')}</p></details>`;
}
async function refresh(){
 if(busy)return;const version=revision;
 try{
  const j=await api('state'+(targetId?'&session='+encodeURIComponent(targetId):''));if(version!==revision||busy)return;csrf=j.csrf;joinSession=j.join_session;activeId=j.active_id;
  let p=j.participant;
  if(!p&&joinSession){const ticket=savedTicket(joinSession.id);if(ticket){try{p=(await api('join',{ticket,session:joinSession.id})).participant;}catch{try{localStorage.removeItem('hl-entry-'+joinSession.id);}catch{}}}}
  render(p);
 }catch(e){message('#notice',e.message);}
}
$('#join-form').addEventListener('submit',async e=>{
 e.preventDefault();if(busy)return;busy=true;revision++;e.submitter.disabled=true;
 try{const j=await api('join',{session:joinSession.id,name:$('#name').value,...(savedTicket(joinSession.id)?{ticket:savedTicket(joinSession.id)}:{})});message('#notice');render(j.participant);window.scrollTo(0,0);}catch(e){message('#notice',e.message);}finally{busy=false;e.submitter.disabled=false;}
});
$('#choices-form').addEventListener('change',()=>{progress();message('#choice-error');try{localStorage.setItem('hl-draft-'+participant.ticket,JSON.stringify(choices()));}catch{}});
$('#choices-form').addEventListener('submit',async e=>{
 e.preventDefault();const c=choices();if(c.includes(null)){message('#choice-error','Choose A or B in all 10 rows.');$(`input[name="choice${c.indexOf(null)+1}"]`).focus();return;}if(busy)return;busy=true;revision++;$('#submit').disabled=true;
 try{const j=await api('submit',{ticket:participant.ticket,choices:c});message('#notice');render(j.participant);window.scrollTo(0,0);}catch(e){message('#choice-error',e.message);}finally{busy=false;$('#submit').disabled=false;}
});
$('#check-room').addEventListener('click',()=>{message('#notice');refresh();});
$('#name').addEventListener('input',()=>message('#notice'));
$('#practice-next').addEventListener('click',async()=>{if(busy)return;busy=true;revision++;try{await api('leave',{});try{localStorage.removeItem('hl-entry-'+participant.class_id);}catch{}participant=null;$('#name').value='';renderJoin();window.scrollTo(0,0);}catch(e){message('#notice',e.message);}finally{busy=false;}});
refresh();setInterval(()=>{if(!document.hidden)refresh();},5000);
