(()=>{
'use strict';
const $=id=>document.getElementById(id),S={i:[],d:[],r:null};
const brl=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n||0);
const STATUS={
 CONCILIADO:'CONCILIADO',
 CONCILIADO_AGRUPADO:'CONCILIADO AGRUPADO',
 CONCILIADO_VALOR:'CONCILIADO VALOR',
 ANALISAR_CONCILIACAO:'ANALISAR CONCILIAÇÃO',
 NAO_ENCONTRADO:'NÃO ENCONTRADO',
 ENCONTRADO_PARCIAL:'ENCONTRADO PARCIAL'
};
const statusLabel=s=>STATUS[s]||s;
const statusClass=s=>({CONCILIADO:'ok',CONCILIADO_AGRUPADO:'ok',CONCILIADO_VALOR:'value',ANALISAR_CONCILIACAO:'review',NAO_ENCONTRADO:'bad',ENCONTRADO_PARCIAL:'partial'}[s]||'');
const analyzeBtn=$('analyze');

function updateAnalyzeState(){
  analyzeBtn.disabled=!(S.i.length>0 && S.d.length>0);
  if(analyzeBtn.disabled && !S.i.length && !S.d.length) $('message').textContent='';
}
function dms(v){if(typeof v==='number')return Number.isFinite(v)?v:NaN;let s=String(v??'').replace(/R\$/gi,'').replace(/\s/g,'').trim();if(!s)return NaN;const paren=/^\(.*\)$/.test(s);s=s.replace(/[()]/g,'');let sign=1;if(s.startsWith('-')){sign=-1;s=s.slice(1)}else if(s.startsWith('+'))s=s.slice(1);if(/\d{1,3}(\.\d{3})*,\d{2}$/.test(s)||/^\d+,\d{2}$/.test(s))s=s.replace(/\./g,'').replace(',','.');else if(/^\d{1,3}(,\d{3})*\.\d+$/.test(s))s=s.replace(/,/g,'');else if(/^\d+(?:\.\d+)?$/.test(s)){}else return NaN;const n=Number(s);return Number.isFinite(n)?(paren?-1:sign)*n:NaN}
function dm(v){const n=dms(v);return Number.isFinite(n)?Math.abs(n):NaN}
function dt(v){if(v instanceof Date)return v.toLocaleDateString('pt-BR');let s=String(v??'').trim(),m=s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);return m?`${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}/${m[3]}`:''}
function parseI(text){
 const lines=String(text||'').replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean),out=[];
 lines.forEach((line,n)=>{
   let c=line.includes('\t')?line.split('\t'):line.includes('|')?line.split('|'):line.includes(';')?line.split(';'):[line];
   c=c.map(x=>String(x??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim());
   const dates=c.map(dt).filter(Boolean),signedNums=c.map(dms).filter(x=>Number.isFinite(x)&&x!==0);
   if(!dates.length||!signedNums.length)return;
   const signedValue=signedNums[signedNums.length-1],date=dates[0],history=c[1]||'',account=c[2]||'';
   const h=String(history).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
   const creditLike=/recebimento|recebimentos|entrada pix|dep din|deposito|boleto recebido|cielo/.test(h);
   const paymentLike=/pagamento|pagamentos|sispag tributos|pag tit|tributo|darf/.test(h);
   if(creditLike || (signedValue>0 && !paymentLike))return;
   const value=Math.abs(signedValue);
   const name=c[3]||c.find(x=>x&&!dt(x)&&!Number.isFinite(dms(x)))||line;
   const taxId=(c[4]||'').replace(/\D/g,'');
   if(/^(data|histórico|historico|valor|favorecido|cpf\/cnpj)$/i.test(String(name).trim()))return;
   out.push({id:'I'+n,name,payee:name,value,date,history,account,taxId,document:taxId,bankName:name,rawText:c.join(' | '),originalColumns:c,original:line,signedValue});
 });
 if(!out.length)throw Error('Não consegui identificar os pagamentos do Itaú. Cole as linhas completas da planilha.');
 return out
}
function mapD(rows){
 let h=(rows[0]||[]).map(x=>String(x??'').trim()),norm=x=>x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 const find=(names)=>h.findIndex(x=>names.some(n=>norm(x)===norm(n)||norm(x).includes(norm(n))));
 let a=find(['TituloPessoaNome','Pessoa Nome','Fornecedor','Nome']),b=find(['TituloValor','Valor']),c=find(['TitDataMov','Data Movimento','Data']),cash=find(['TitMovDataCaixa','Data Caixa','Dt Caixa']),d=find(['TituloNumeroParcela','Nº - Parcela','Numero Parcela','Título']),cd=find(['TituloCDDescr','CD Descr','Tipo Movimento']),hist=find(['TituloHistorico','Histórico','Historico']),mult=find(['TituloMultiplicador','Multiplicador']);
 if(a<0||b<0) throw Error('Não encontrei as colunas de nome e valor no Excel do Dealer.');
 return rows.slice(1).map((r,i)=>{
   const name=String(r[a]??'').trim(),value=dm(r[b]),movementDate=c>=0?dt(r[c]):'',cashDate=cash>=0?dt(r[cash]):'';
   const cdText=cd>=0?String(r[cd]??''):'',histText=hist>=0?String(r[hist]??''):'';
   const classText=(cdText+' '+histText).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
   const multiplier=mult>=0?dms(r[mult]):NaN;
   if((cdText||histText) && /recebimento de titulo/.test(classText))return null;
   if(cdText && !/pagamento de titulos/.test(classText))return null;
   if(Number.isFinite(multiplier) && multiplier>0)return null;
   return {id:'D'+i,name,value,date:movementDate||cashDate,movementDate,cashDate,title:d>=0?String(r[d]??''):'',parcel:d>=0?String(r[d]??''):'',note:d>=0?String(r[d]??'').split('-')[0].replace(/\D/g,''):'',history:histText,cdDescr:cdText};
 }).filter(x=>x&&x.name&&Number.isFinite(x.value)&&x.value>0)
}
function esc(v){return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]))}
function partyName(x){return x?.name||x?.payee||'—'}
function sideSummary(items,side){
 if(!items.length)return '—';
 const first=partyName(items[0]);
 if(items.length===1)return esc(first);
 const noun=side==='I'?'pagamentos':'lançamentos';
 return `<strong>${esc(first)}</strong><small>${items.length} ${noun} agrupados</small>`;
}
function groupNote(x){
 if(x.status!=='CONCILIADO_AGRUPADO')return '';
 const ni=x.itau.length,nd=x.dealer.length;
 if(ni===1&&nd>1)return `Agrupou ${nd} lançamentos do Dealer · 1×${nd}`;
 if(ni>1&&nd===1)return `Agrupou ${ni} pagamentos do Itaú · ${ni}×1`;
 return `Agrupou ${ni} Itaú × ${nd} Dealer`;
}
function statusCell(x){
 const title=esc(x.reason||x.type||'');
 const note=groupNote(x);
 return `<strong title="${title}">${statusLabel(x.status)}</strong>${note?`<small>${esc(note)}</small>`:''}`;
}
function render(){
 let r=S.r;if(!r)return;$('results').classList.remove('hidden');
 $('ki').textContent=r.totals.itauCount;$('kiv').textContent=brl(r.totals.itauValue);$('kde').textContent=r.totals.dealerCount;$('kdev').textContent=brl(r.totals.dealerValue);
 const closed=r.conciliado.length+r.agrupado.length+r.valor.length;
 const pending=r.analisar.length+r.parcial.length+r.naoEncontrado.length;
 $('ko').textContent=closed;$('kd').textContent=pending;
 $('km').textContent=`${r.parcial.length} parciais · ${r.analisar.length} analisar · ${r.naoEncontrado.length} não encontrados`;
 let q=$('search').value.toUpperCase();
 let rows=r.all.filter(x=>!q||[...x.itau,...x.dealer].some(y=>((y.name||y.payee||'')+' '+(y.title||y.note||'')+' '+(y.document||y.taxId||'')).toUpperCase().includes(q)));
 $('body').innerHTML=rows.map(x=>{
   const i=x.itau.length?x.itau[0]:null,d=x.dealer.length?x.dealer[0]:null;
   const iv=x.itau.reduce((s,a)=>s+a.value,0),dv=x.dealer.reduce((s,a)=>s+a.value,0),diff=iv-dv;
   const itauLabel=sideSummary(x.itau,'I');
   const dealerLabel=sideSummary(x.dealer,'D');
   const history=i?.history?`<small>${esc(i.history)}</small>`:'';
   return `<tr>
    <td>${esc(i?.date||d?.date||d?.movementDate||d?.cashDate||'')}</td>
    <td>${x.itau.length===1?`<strong>${itauLabel}</strong>`:itauLabel}${history}</td>
    <td>${x.dealer.length===1?`<strong>${dealerLabel}</strong>`:dealerLabel}</td>
    <td>${brl(iv)}</td><td>${brl(dv)}</td>
    <td class="${Math.abs(diff)>.01?'bad':'ok'}">${brl(diff)}</td>
    <td class="${statusClass(x.status)} status-cell">${statusCell(x)}</td>
   </tr>`}).join('');
 $('rowCount').textContent=`${rows.length} conciliações/ocorrências`;
}
function parseDealerTextInput(){
 let lines=$('dealerText').value.split(/\r?\n/).filter(Boolean),out=[];
 lines.forEach((l,i)=>{let c=l.includes('\t')?l.split('\t'):l.split('|'),dates=c.map(dt).filter(Boolean),nums=c.map(dm).filter(x=>Number.isFinite(x)&&x!==0);if(dates.length&&nums.length){const name=c.find(x=>!dt(x)&&!Number.isFinite(dm(x)))||l;out.push({id:'DT'+i,name,value:nums[nums.length-1],date:dates[0]})}});
 return out;
}
$('itauText').oninput=()=>{try{S.i=parseI($('itauText').value);$('itauStatus').textContent=`${S.i.length} pagamentos reconhecidos · ${brl(S.i.reduce((s,x)=>s+x.value,0))}`}catch(e){S.i=[];$('itauStatus').textContent=$('itauText').value.trim()?e.message:'Aguardando dados.'}S.r=null;$('results').classList.add('hidden');updateAnalyzeState()};
$('dealerFile').onchange=async e=>{let f=e.target.files[0];if(!f){S.d=[];updateAnalyzeState();return}try{let wb=XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:true}),rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});S.d=mapD(rows);$('dealerStatus').textContent=`${S.d.length} movimentos reconhecidos · ${brl(S.d.reduce((s,x)=>s+x.value,0))}`}catch(e){S.d=[];$('dealerStatus').textContent=e.message||'Não foi possível ler o Excel do Dealer.'}S.r=null;$('results').classList.add('hidden');updateAnalyzeState()};
$('dealerText').oninput=()=>{S.d=parseDealerTextInput();$('dealerStatus').textContent=S.d.length?`${S.d.length} movimentos reconhecidos`:'Aguardando Excel ou dados do Dealer.';S.r=null;$('results').classList.add('hidden');updateAnalyzeState()};
$('clear').onclick=()=>{$('itauText').value='';S.i=[];$('dealerText').value='';S.d=[];S.r=null;$('dealerFile').value='';$('itauStatus').textContent='Aguardando dados.';$('dealerStatus').textContent='Aguardando dados.';$('results').classList.add('hidden');$('processBox').classList.add('hidden');$('message').textContent='';updateAnalyzeState()};
$('analyze').onclick=async()=>{
 if(!S.i.length||!S.d.length){updateAnalyzeState();return;}
 const btn=$('analyze'),box=$('processBox'),title=$('processTitle'),detailBox=$('processDetail'),set=(t,d,cls='')=>{box.className='process-box '+cls;title.textContent=t;detailBox.textContent=d};
 btn.disabled=true;box.classList.remove('hidden');$('message').textContent='';
 try{
  set('Validando dados','Conferindo pagamentos do Itaú e movimentos do Dealer...');await new Promise(r=>setTimeout(r,40));
  set('Processando conciliação',`${S.i.length} pagamentos × ${S.d.length} movimentos. Testando correspondências e agrupamentos...`);await new Promise(r=>setTimeout(r,40));
  S.r=IntelligentReconciler.reconcile(S.i,S.d,{tolerance:.011,maxGroup:20,maxSubset:12});
  set('Processamento concluído',`${S.r.conciliado.length+S.r.agrupado.length+S.r.valor.length} conciliados · ${S.r.parcial.length} encontrados parcialmente · ${S.r.analisar.length} para analisar.`,'done');$('message').textContent='Conciliação concluída.';render();
 }catch(e){set('Não foi possível concluir',e.message,'error');$('message').textContent=e.message}finally{updateAnalyzeState()}
};
$('search').oninput=render;
updateAnalyzeState();
})();
