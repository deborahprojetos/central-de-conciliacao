
(function(){
'use strict';
var $=id=>document.getElementById(id),dealerRows=[],platformRows=[];
const escape=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateRe=/\b(\d{1,2}\/\d{1,2}(?:\/\d{4})?)\b/;
const moneyRe=/(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}\b|(?:R\$\s*)?-?\d+,\d{2}\b/g;
const taxRe=/\b(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})\b/;
function currency(v){if(!v)return '';let n=Number(String(v).replace(/R\$/g,'').replace(/\./g,'').replace(',','.').replace(/[^\d.-]/g,''));return Number.isFinite(n)?n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):v}
function rows(text){return text.replace(/\r/g,'').split('\n').map(s=>s.trim()).filter(Boolean).filter(s=>!/^\|?\s*[-:| ]{4,}\|?$/.test(s))}
function cells(s){return (s.includes('\t')?s.split('\t'):s.includes('|')?s.replace(/^\||\|$/g,'').split('|'): [s]).map(x=>x.trim()).filter(Boolean)}
function parseDealer(text){let out=[];rows(text).forEach(s=>{if(/data.*saldo|lançamento.*valor.*saldo/i.test(s))return;let c=cells(s),d=s.match(dateRe);if(!d)return;let obs=c.find(x=>/\[\d{5,}\]|PIX TRANSF|SISPAG|\bTED\b/i.test(x))||s.match(/\[\d{5,}\][^|]*/)?.[0]||'';let before=obs?s.slice(0,s.indexOf(obs)):s;let amounts=[...before.matchAll(moneyRe)].map(m=>m[0]);let saldo=amounts.length?amounts[amounts.length-1]:'';if(!saldo){let di=c.findIndex(x=>dateRe.test(x));let nums=c.slice(di+1).filter(x=>/^-?[\d.]+(?:,\d{2})?$/.test(x));saldo=nums.length?nums[nums.length-1]:''}out.push({data:d[1],saldo:currency(saldo),observacao:obs.trim()})});return out}
function parsePlatform(text){
const mapped=rows(text).filter(x=>x.includes('\t')&&dateRe.test(x));
if(mapped.length&&mapped.length===rows(text).length){
return mapped.map(s=>{let parts=s.split('\t').map(x=>x.trim()),date=parts[0].match(dateRe)?.[0]||'',lanc=parts[1]||'',detail=parts[2]||'',amount=parts[3]||'',cpf=detail.match(taxRe)?.[0]||'',origin=detail.match(/\b\d{3,5}\s*\/\s*\d{5,}(?:-\d+)?/)?.[0]||'';
let supplier=detail.replace(/Ag\s*\/\s*origem/i,' ').replace(/CPF\s*\/\s*CNPJ/i,' ').replace(origin,' ').replace(cpf,' ').replace(/\s+/g,' ').replace(/\s*[-:]\s*$/,'').trim();
if(!origin){origin=detail.match(/\b\d{3,5}\s*\/\s*\d{5,}(?:-\d+)?/)?.[0]||'';}
return {data:date,lancamento:lanc,fornecedor:supplier,origem:origin,cpf:cpf,valor:currency((amount.match(moneyRe)||[]).pop()||amount)};});
}
let ls=rows(text),out=[];let blocks=[];ls.forEach(s=>{if(/^data\s*[\t|]/i.test(s))return;let c=cells(s);if(dateRe.test(s)&&(/PIX|TED|SISPAG|RECEBIDO|R\$|\d+,\d{2}/i.test(s)||c.length>=4))blocks.push(s);else if(blocks.length)blocks[blocks.length-1]+='\t'+s;else blocks.push(s)});blocks.forEach(s=>{let c=cells(s),dt=s.match(dateRe),tax=s.match(taxRe),am=[...s.matchAll(moneyRe)],valor=am.length?am[am.length-1][0]:'';if(!dt&&!tax&&!valor)return;let origin=s.match(/(?:Ag\s*\/\s*origem\s*[:\s]*)?(\d{3,5}\/\d{5,}(?:-\d+)?)/i);let idx=c.findIndex(x=>dateRe.test(x));let lanc=c[idx+1]||'';let forn=c[idx+2]||'';if(c.length===1){let tail=s.slice(dt?dt.index+dt[0].length:0).trim();lanc=tail.replace(/\b(?:Ag\s*\/\s*origem|CPF\/CNPJ)\b[\s\S]*/i,'').replace(valor,'').trim();forn=''}if(forn&&/^(Ag\/origem|\d{3,5}\/|CPF\/CNPJ)/i.test(forn))forn='';if(!forn&&c.length>=4){let opt=c.slice(idx+1).find(x=>x!==lanc&&!taxRe.test(x)&&!moneyRe.test(x)&&!/^Ag\/origem/i.test(x));forn=opt||''}out.push({data:dt?dt[1]:'',lancamento:lanc,fornecedor:forn,origem:origin?origin[1]:'',cpf:tax?tax[0]:'',valor:currency(valor)})});return out}

let currentPrint=null;
function setPrint(file,autoRead=false){
if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type)){ $('ocrStatus').textContent='Escolha uma imagem PNG, JPG ou WEBP.';return;}
if(file.size>15*1024*1024){$('ocrStatus').textContent='Imagem muito grande. Limite de 15 MB.';return;}
currentPrint=file;$('extrair').disabled=false;
const reader=new FileReader();
reader.onload=()=>{$('printPreview').src=reader.result;$('printPreview').classList.remove('hidden')};
reader.readAsDataURL(file);$('ocrStatus').textContent='Print recebido. Iniciando leitura...';if(autoRead) extractPrint();
}
$('print').addEventListener('change',e=>setPrint(e.target.files[0]));
const drop=$('dropPrint');
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag')});
drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag');setPrint(e.dataTransfer.files[0])});
document.addEventListener('paste',e=>{const item=[...(e.clipboardData?.items||[])].find(i=>i.type.startsWith('image/'));if(item){e.preventDefault();setPrint(item.getAsFile(),true)}});
function tsvToRows(tsv,width){
if(!tsv)return null;
const words=tsv.split(/\r?\n/).slice(1).map(line=>line.split('\t')).filter(c=>c.length>=12&&c[0]==='5'&&c.slice(11).join('\t').trim()).map(c=>({text:c.slice(11).join('\t').trim(),left:+c[6],top:+c[7],height:+c[9]})).filter(w=>Number.isFinite(w.left)&&Number.isFinite(w.top));
const seeds=words.filter(w=>w.left<width*.20&&/^\d{1,2}\/\d{1,2}$/.test(w.text)).sort((a,b)=>a.top-b.top);
if(!seeds.length)return null;
return seeds.map((seed,i)=>{
const low=seed.top-18,high=i+1?seeds[i+1].top-9:Infinity;
let block=words.filter(w=>w.top>=low&&w.top<high);
let columns=[[],[],[],[]];
block.forEach(w=>{let col=w.left<width*.19?0:w.left<width*.51?1:w.left<width*.80?2:3;columns[col].push(w)});
return columns.map(col=>{col.sort((a,b)=>(Math.round(a.top/16)-Math.round(b.top/16))||a.left-b.left);return col.map(w=>w.text).join(' ').replace(/\s+/g,' ').trim()}).join('\t');
}).join('\n');
}
function platformFromImage(text,tsv,width){
const mapped=tsvToRows(tsv,width);
if(mapped&&mapped.trim())return mapped;
return text;
}
async function extractPrint(){
if(!currentPrint)return;
if(!window.Tesseract){$('ocrStatus').textContent='Leitor de imagem indisponível. Verifique sua conexão e tente novamente.';return;}
$('extrair').disabled=true;$('gerar').disabled=true;
let worker=null;
try{
$('ocrStatus').textContent='Lendo o print...';
worker=await Tesseract.createWorker('por',1,{logger:m=>{if(m.status==='recognizing text')$('ocrStatus').textContent='Reconhecendo dados: '+Math.round((m.progress||0)*100)+'%';}});
const result=await worker.recognize(currentPrint,{}, {text:true,tsv:true});
const raw=platformFromImage(result.data.text,result.data.tsv, result.data.width||$('printPreview').naturalWidth);
$('plataforma').value=raw.trim();
$('ocrStatus').textContent=raw.trim()?'Dados extraídos. Confira a tabela gerada abaixo.':'Não encontrei texto legível nesse print.';
generate();
}catch(err){$('ocrStatus').textContent='Erro ao ler print: '+String(err&&err.message||err).slice(0,140)+'';console.error('OCR:',err)}
finally{if(worker)try{await worker.terminate()}catch(e){};$('extrair').disabled=false;$('gerar').disabled=false}
}
$('extrair').addEventListener('click',extractPrint);

function table(head,data,keys){return '<table><thead><tr>'+head.map(h=>'<th>'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+data.map(r=>'<tr>'+keys.map(k=>'<td'+(['saldo','valor'].includes(k)?' class="money"':'')+'>'+escape(r[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table>'}
function generate(){dealerRows=parseDealer($('dealer').value);platformRows=parsePlatform($('plataforma').value);let notices=[];if($('dealer').value.trim()&&!dealerRows.length)notices.push('Nenhuma linha do Dealer reconhecida.');if($('plataforma').value.trim()&&!platformRows.length)notices.push('Nenhuma linha da plataforma reconhecida.');if(platformRows.some(r=>!r.fornecedor||!r.origem||!r.cpf))notices.push('Alguns registros da plataforma estão incompletos. Confira fornecedor, Ag/Origem e CPF/CNPJ antes de enviar.');if(dealerRows.some(r=>!r.saldo||!r.observacao))notices.push('Alguns registros do Dealer estão incompletos. Confira saldo e observação.');$('avisos').classList.toggle('hidden',!notices.length);$('avisos').textContent=notices.join(' ');let content='<p>'+escape($('mensagem').value)+'</p>';if(dealerRows.length)content+='<h3>1. Dados do Dealer ('+dealerRows.length+')</h3>'+table(['Data','Saldo','Observação'],dealerRows,['data','saldo','observacao']);if(platformRows.length)content+='<h3>2. Dados da Plataforma ('+platformRows.length+')</h3>'+table(['Data','Lançamento','Fornecedor','Ag/Origem','CPF/CNPJ','Valor'],platformRows,['data','lancamento','fornecedor','origem','cpf','valor']);content+='<p style="margin-top:20px">Aguardo retorno para regularização das pendências.</p>';$('saida').innerHTML=(dealerRows.length||platformRows.length)?content:'<p>Nenhum registro reconhecido. Cole os dados e tente novamente.</p>';$('copiar').disabled=!(dealerRows.length||platformRows.length);$('status').textContent=dealerRows.length+' registro(s) Dealer e '+platformRows.length+' da plataforma.'}
$('gerar').addEventListener('click',generate);$('limpar').addEventListener('click',()=>{$('dealer').value='';$('plataforma').value='';currentPrint=null;$('print').value='';$('printPreview').classList.add('hidden');$('printPreview').removeAttribute('src');$('extrair').disabled=true;$('ocrStatus').textContent='';$('saida').innerHTML='<p>O modelo padronizado aparecerá aqui depois de clicar em Gerar e-mail.</p>';$('avisos').classList.add('hidden');$('status').textContent='';$('copiar').disabled=true});
$('copiar').addEventListener('click',async()=>{let html='<div><p><b>Assunto:</b> '+escape($('assunto').value)+'</p>'+$('saida').innerHTML+'</div>';let plain='Assunto: '+$('assunto').value+'\n\n'+$('saida').innerText;try{if(navigator.clipboard&&window.ClipboardItem){await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);$('status').textContent='E-mail formatado copiado.'}else{await navigator.clipboard.writeText(plain);$('status').textContent='Texto copiado.'}}catch(e){$('status').textContent='Cópia bloqueada pelo navegador. Selecione o conteúdo da prévia e copie manualmente.'}});})();
