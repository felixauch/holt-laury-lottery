const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Results=require('../app/results.js');
const d=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'fixture.json'),'utf8'));
assert.deepEqual(Results.summary(d),{n:3,mean:13/3,reversals:1});
const report=Results.render(d);
assert(report.includes('4.3 / 10'));
assert(report.includes('Not submitted'));
assert(report.includes('67%'));
assert(report.includes('Test Alex')&&report.includes('Test Bea')&&report.includes('Test Chen'));
const empty={completed:0,histogram:Array(11).fill(0),a_counts:Array(10).fill(0),nonmonotonic:0,participants:[]};
assert.equal(Results.summary(empty).mean,null);
assert(Results.render(empty).includes('No completed submissions.'));
const unsafe=structuredClone(d);unsafe.participants[0].name='<script>alert(1)</script>';
assert(!Results.render(unsafe).includes('<script>'));
assert(Results.render(unsafe).includes('&lt;script&gt;'));

// Exercise the real one-step close/draw handler without changing a live class.
const elements=new Map();const handlers={};const requests=[];
function element(selector){if(!elements.has(selector))elements.set(selector,{hidden:false,disabled:false,open:false,dataset:{},innerHTML:'',textContent:'',value:'',checked:false,addEventListener:(event,handler)=>{handlers[selector+':'+event]=handler;},querySelectorAll:()=>[],scrollIntoView:()=>{},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(selector);}
const model=structuredClone(d);model.session={id:'TEST',state:'open',mode:'practice',title:'Fixture',payoffs:{A:[400,320],B:[770,20]},winners:[]};
const sandbox={document:{querySelector:element,hidden:false},setInterval:()=>{},Results,console,fetch:async(url,options)=>{
 const action=url.split('action=')[1];const input=options.body?JSON.parse(options.body):null;requests.push({action,input});
 let body;
 if(action==='state')body={csrf:'test',admin:false};
 else if(action==='sessions')body={active_id:'TEST',sessions:[model.session]};
 else if(action==='details&id=TEST')body=model;
 else if(action==='finish'){model.session.state='drawn';model.session.winners=[{name:'Test Alex',ticket:'fixture',row:4,choice:'A',die:2,cents:400},{name:'Test Bea',ticket:'fixture2',row:9,choice:'B',die:1,cents:770}];body={winners:model.session.winners};}
 else if(action==='phase'){model.session.state=input.state;body={ok:true};}
 else throw Error('Unexpected action: '+action);
 return {ok:true,status:200,json:async()=>body};
}};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../app/admin.js'),'utf8'),sandbox);
(async()=>{
 await new Promise(resolve=>setImmediate(resolve));
 vm.runInContext("signedIn=true;currentId='TEST';",sandbox);
 await vm.runInContext('refresh()',sandbox);
 assert.equal(element('#results').hidden,true);
 await handlers['#close:click']();
 assert.equal(model.session.state,'drawn');
 assert.equal(element('#results').hidden,false);
 assert.equal(element('#winners').hidden,false);
 assert.equal(element('#presentation').hidden,false);
 assert.equal(element('#session-controls').open,false);
 assert.equal(element('#dashboard').dataset.phase,'drawn');
 assert.equal(element('#close').hidden,true);
 assert.equal(element('#finish').hidden,true);
 assert(element('#winners').innerHTML.includes('Row 4'));
 assert(element('#winners').innerHTML.includes('CHF 7.70'));
 assert.deepEqual(requests.filter(r=>['phase','finish','draw'].includes(r.action)).map(r=>r.action),['finish']);
 model.session.state='open';model.completed=1;
 await vm.runInContext('refresh()',sandbox);
 assert.equal(element('#close').disabled,true);
 assert.equal(element('#results').hidden,true);
 console.log('Passed: known practice statistics, safe names, zero responses, close performs one finish request and reveals winners/rows/statistics, and two-submission minimum.');
})().catch(e=>{console.error(e);process.exitCode=1;});

