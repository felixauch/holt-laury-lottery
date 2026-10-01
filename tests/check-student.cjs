const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function check(payoffs,a,b,range){
 const els=new Map(); const element=s=>{if(!els.has(s))els.set(s,{textContent:'',innerHTML:'',hidden:false,value:'',addEventListener(){}});return els.get(s);};
 const p={ticket:'test',class_id:'fixture',name:'Test',mode:'practice',state:'open',payoffs,submitted:null};
 const sandbox={document:{querySelector:element},location:{href:'https://example.test/'},URL,history:{replaceState(){}},localStorage:{getItem(){return null;},setItem(){}},setInterval(){},fetch:async()=>({ok:true,json:async()=>({csrf:'test',participant:p,join_session:{id:'fixture'},active_id:'fixture'})})};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../app/student.js'),'utf8'),sandbox);await new Promise(r=>setImmediate(r));
 assert.equal(element('#payoffs-a').textContent,a);assert.equal(element('#payoffs-b').textContent,b);assert.equal(element('#payment-range').textContent,range);assert(element('#choices').innerHTML.includes('100% chance of CHF '+(payoffs.B[0]/100).toFixed(2)));
}
(async()=>{await check({A:[400,320],B:[770,20]},'CHF 4.00 / 3.20','CHF 7.70 / 0.20','CHF 0.20\u20137.70');await check({A:[550,450],B:[1000,100]},'CHF 5.50 / 4.50','CHF 10.00 / 1.00','CHF 1.00\u201310.00');console.log('Passed: new classic and legacy student payoff displays and accessible choice labels.');})().catch(e=>{console.error(e);process.exitCode=1;});
