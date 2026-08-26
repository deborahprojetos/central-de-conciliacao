(()=>{const $=id=>document.getElementById(id),S={i:[],d:[],r:null,v:'all'};const brl=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n||0);
function dm(v){if(typeof v==='number')return Math.abs(v);let s=String(v??'').replace(/R\$/gi,'').replace(/\s/g,'');if(!s)return NaN;s=s.replace(/[()]/g,'').replace(/^-/,'');if(/\d{1,3}(\.\d{3})*,\d{2}$/.test(s)||/^\d+,\d{2}$/.test(s))s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');return Math.abs(Number(s))}
function dt(v){if(v instanceof Date)return v.toLocaleDateString('pt-BR');let s=String(v??'').trim(),m=s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);return m?`${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}/${m[3]}`:''}
function parseI(text){
 const lines=String(text||'').replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean),out=[];
 lines.forEach((line,n)=>{
   let c=line.includes('\t')?line.split('\t'):line.includes('|')?line.split('|'):line.includes(';')?line.split(';'):[line];
   c=c.map(x=>String(x??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim());
   const dates=c.map(dt).filter(Boolean),nums=c.map(dm).filter(x=>Number.isFinite(x)&&x!==0);
   if(!dates.length||!nums.length)return;
   const value=nums[nums.length-1],date=dates[0],history=c[1]||'',account=c[2]||'';
   const name=c[3]||c.find(x=>x&&!dt(x)&&!Number.isFinite(dm(x)))||line;
   const taxId=(c[4]||'').replace(/\D/g,'');
   if(/^(data|histórico|historico|valor|favorecido|cpf\/cnpj)$/i.test(String(name).trim()))return;
   out.push({id:'I'+n,name,value,date,history,account,taxId,bankName:name,rawText:c.join(' | '),originalColumns:c,original:line});
 });
 if(!out.length)throw Error('Não consegui identificar os pagamentos do Itaú. Cole as linhas completas da planilha.');
 return out
}
function mapD(rows){let h=rows[0].map(x=>String(x??'').trim()),ix=n=>h.findIndex(x=>x.toLowerCase()===n.toLowerCase()),a=ix('TituloPessoaNome'),b=ix('TituloValor'),c=ix('TitDataMov'),d=ix('TituloNumeroParcela');return rows.slice(1).map((r,i)=>({id:'D'+i,name:String(r[a]??'').trim(),value:dm(r[b]),date:dt(r[c]),title:String(r[d]??'')})).filter(x=>x.name&&Number.isFinite(x.value))}
function names(xs){return xs.map(x=>x.name).filter(Boolean).join(' + ')}
function detail(x){return x.dealer.map(d=>`${d.name} (${brl(d.value)})`).join(' + ')}
function render(){let r=S.r;if(!r)return;$('results').classList.remove('hidden');
 $('ki').textContent=r.totals.itauCount;$('kiv').textContent=brl(r.totals.itauValue);$('kde').textContent=r.totals.dealerCount;$('kdev').textContent=brl(r.totals.dealerValue);
 $('ko').textContent=r.matches.length;$('kd').textContent=r.differences.length+r.itauSem.length+r.dealerSem.length;
 $('km').textContent=`${r.itauSem.length} Itaú sem Dealer · ${r.dealerSem.length} Dealer sem Itaú`;
 let q=$('search').value.toUpperCase();
 let rows=r.all.filter(x=>S.v==='all'||S.v==='matched'&&x.status==='CONCILIADO'||S.v==='exceptions'&&x.status!=='CONCILIADO'||S.v==='itauOnly'&&x.status==='ITAU_SEM_DEALER'||S.v==='dealerOnly'&&x.status==='DEALER_SEM_ITAU')
 .filter(x=>!q||[...x.itau,...x.dealer].some(y=>(y.name+' '+(y.title||'')).toUpperCase().includes(q)));
 $('body').innerHTML=rows.map(x=>{
   const i=x.itau.length?x.itau[0]:null,iv=x.itau.reduce((s,a)=>s+a.value,0),dv=x.dealer.reduce((s,d)=>s+d.value,0),diff=iv-dv;
   const dealerLabel=x.dealer.length?detail(x):'—';
   const itauLabel=x.itau.length>1?`${names(x.itau)} (agrupado)`:i?.name||'—';
   return `<tr>
    <td>${i?.date||x.dealer[0]?.date||''}</td>
    <td><strong>${itauLabel}</strong><small>${i?.history||''}</small></td>
    <td>${dealerLabel}</td>
    <td>${brl(iv)}</td><td>${brl(dv)}</td>
    <td class="${Math.abs(diff)>.01?'bad':'ok'}">${brl(diff)}</td>
    <td class="${x.status==='CONCILIADO'?'ok':x.status==='DIVERGENCIA'?'warn':'bad'}">${x.status}</td>
    <td><small>${x.type||''}</small></td>
   </tr>`}).join('');
 $('rowCount').textContent=`${rows.length} registros`;
}
$('itauText').oninput=()=>{try{S.i=parseI($('itauText').value);$('itauStatus').textContent=`${S.i.length} pagamentos reconhecidos · ${brl(S.i.reduce((s,x)=>s+x.value,0))}`}catch(e){S.i=[];$('itauStatus').textContent=e.message}};
$('dealerFile').onchange=async e=>{let f=e.target.files[0];if(!f)return;try{let wb=XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:true}),rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});S.d=mapD(rows);$('dealerStatus').textContent=`${S.d.length} movimentos reconhecidos · ${brl(S.d.reduce((s,x)=>s+x.value,0))}`}catch(e){$('dealerStatus').textContent='Não foi possível ler o Excel do Dealer.'}};
$('dealerText').oninput=()=>{let lines=$('dealerText').value.split(/\r?\n/).filter(Boolean),out=[];lines.forEach((l,i)=>{let c=l.includes('\t')?l.split('\t'):l.split('|'),dates=c.map(dt).filter(Boolean),nums=c.map(dm).filter(x=>Number.isFinite(x)&&x!==0);if(dates.length&&nums.length)out.push({id:'D'+i,name:c.find(x=>!dt(x)&&!Number.isFinite(dm(x)))||l,value:nums[nums.length-1],date:dates[0]})});S.d=out;$('dealerStatus').textContent=`${out.length} movimentos reconhecidos`};
$('clear').onclick=()=>{$('itauText').value='';S.i=[];$('dealerText').value='';S.d=[];$('itauStatus').textContent='Aguardando dados.';$('dealerStatus').textContent='Aguardando dados.';$('results').classList.add('hidden')};
$('analyze').onclick=async()=>{const btn=$('analyze'),box=$('processBox'),title=$('processTitle'),detailBox=$('processDetail'),set=(t,d,cls='')=>{box.className='process-box '+cls;title.textContent=t;detailBox.textContent=d};btn.disabled=true;box.classList.remove('hidden');$('message').textContent='';
 try{set('Validando dados','Conferindo pagamentos do Itaú e movimentos do Dealer...');await new Promise(r=>setTimeout(r,80));
 if(!S.i.length)S.i=parseI($('itauText').value);if(!S.d.length)throw Error('Carregue ou cole os movimentos do Dealer.');
 set('Processando conciliação',`${S.i.length} pagamentos × ${S.d.length} movimentos. Testando 1×1, agrupamentos e divergências...`);await new Promise(r=>setTimeout(r,80));
 set('Procurando agrupamentos','Procurando combinações exatas de valores, inclusive quando o nome do banco é diferente do nome do Dealer...');await new Promise(r=>setTimeout(r,80));
 S.r=IntelligentReconciler.reconcile(S.i,S.d,{tolerance:.01,maxGroup:8});set('Processamento concluído',`${S.r.matches.length} conciliações encontradas. As sobras foram classificadas separadamente.`,'done');$('message').textContent='Conciliação concluída.';render();
 }catch(e){set('Não foi possível concluir',e.message,'error');$('message').textContent=e.message}finally{btn.disabled=false}};
$('search').oninput=render;document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.v=b.dataset.v;render()})
})();