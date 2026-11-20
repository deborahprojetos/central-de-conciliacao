
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
currentPrint=file;$('extrair').disabled=false;$('plataforma').value='';$('copiar').disabled=true;
const reader=new FileReader();
reader.onload=()=>{$('printPreview').src=reader.result;$('printPreview').classList.remove('hidden')};
reader.readAsDataURL(file);$('ocrStatus').textContent='Print recebido.';if(autoRead) extractPrint();else generate();
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
let readingPrint=false;
async function extractPrint(){
 if(!currentPrint||readingPrint)return;
 if(!window.Tesseract){$('ocrStatus').textContent='OCR não carregado. Atualize a página para tentar novamente.';generate();return}
 const snapshot=currentPrint;
 readingPrint=true;$('extrair').disabled=true;generate();
 let worker=null,timeoutId=null;
 const status=$('ocrStatus');
 try{
  status.textContent='Preparando a leitura da imagem...';
  const timeout=new Promise((_,reject)=>{timeoutId=setTimeout(()=>reject(new Error('A leitura demorou demais. Tente recortar o print e colar novamente.')),45000)});
  const process=async()=>{
    worker=await Tesseract.createWorker('eng',1,{
      logger:m=>{
       if(!m||!m.status)return;
       if(m.status==='recognizing text')status.textContent='Lendo caracteres: '+Math.round((m.progress||0)*100)+'%';
       else status.textContent='OCR: '+m.status;
      },
      errorHandler:err=>{console.error('OCR worker:',err)}
    });
    status.textContent='Analisando a imagem...';
    let image=snapshot;
    try{
      const bitmap=await createImageBitmap(snapshot);
      const scale=Math.min(3,Math.max(1.5,1800/bitmap.width));
      const canvas=document.createElement('canvas');
      canvas.width=Math.round(bitmap.width*scale);
      canvas.height=Math.round(bitmap.height*scale);
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      bitmap.close();
      image=canvas;
    }catch(e){console.warn('Ampliação da imagem não disponível:',e)}
    const data=(await worker.recognize(image,{}, {text:true,tsv:true})).data||{};
    return platformFromImage(data.text||'',data.tsv||'',image.width||$('printPreview').naturalWidth);
  };
  const result=await Promise.race([process(),timeout]);
  if(currentPrint!==snapshot)return;
  $('plataforma').value=String(result||'').trim();
  if(!$('plataforma').value){status.textContent='Nenhum texto reconhecido. Tente recortar somente as linhas da plataforma.';generate();return}
  generate();
  status.textContent='Leitura concluída. Confira os campos e o e-mail gerado abaixo.';
 }catch(err){
  status.textContent='Não foi possível extrair: '+String(err?.message||err).slice(0,160);generate();
  console.error('Leitura do print:',err);
 }finally{
  if(timeoutId)clearTimeout(timeoutId);
  readingPrint=false;$('extrair').disabled=false;
  if(worker)worker.terminate().catch(()=>{});
 }
}
$('extrair').addEventListener('click',extractPrint);


function table(head,data,keys){
 const td='border:1px solid #cbd5e1;padding:7px 9px;text-align:left;vertical-align:top;font:12px Arial,sans-serif;color:#1d2b45;white-space:normal;';
 return '<table cellpadding="0" cellspacing="0" border="1" style="border-collapse:collapse;width:100%;font:12px Arial,sans-serif;border:1px solid #cbd5e1"><thead><tr>'+head.map(h=>'<th scope="col" bgcolor="#e9eff7" style="'+td+'background-color:#e9eff7;font-weight:bold;">'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+data.map((r,i)=>'<tr>'+keys.map(k=>'<td style="'+td+(k==='saldo'||k==='valor'?'text-align:right;white-space:nowrap;':'')+'">'+escape(r[k]||'')+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
}
function generate(){
 dealerRows=parseDealer($('dealer').value);
 platformRows=parsePlatform($('plataforma').value);
 const notices=[];
 if($('dealer').value.trim()&&!dealerRows.length)notices.push('Nenhuma linha do Dealer reconhecida.');
 if(currentPrint&&!platformRows.length)notices.push(readingPrint?'Aguarde a leitura da imagem para incluir os dados da plataforma.':'A plataforma não foi extraída. Clique em Extrair dados do print e confira o resultado.');
 if($('plataforma').value.trim()&&!platformRows.length)notices.push('Não foi possível estruturar os dados da plataforma. Confira o texto reconhecido.');
 if(platformRows.some(r=>!r.fornecedor||!r.origem||!r.cpf||!r.valor||!r.lancamento))notices.push('Os registros da plataforma estão incompletos. Confira fornecedor, Ag/Origem, CPF/CNPJ, lançamento e valor.');
 if(dealerRows.some(r=>!r.saldo||!r.observacao))notices.push('Alguns registros do Dealer estão incompletos.');
 $('avisos').classList.toggle('hidden',!notices.length);
 $('avisos').textContent=notices.join(' ');
 let content='<p style="font:14px Arial,sans-serif;margin:0 0 16px;">'+escape($('mensagem').value)+'</p>';
 if(dealerRows.length)content+='<h3 style="font:bold 14px Arial,sans-serif;margin:18px 0 9px;">1. Dados do Dealer ('+dealerRows.length+')</h3>'+table(['Data','Saldo','Observação'],dealerRows,['data','saldo','observacao']);
 if(platformRows.length)content+='<h3 style="font:bold 14px Arial,sans-serif;margin:22px 0 9px;">2. Dados da Plataforma ('+platformRows.length+')</h3>'+table(['Data','Lançamento','Fornecedor','Ag/Origem','CPF/CNPJ','Valor'],platformRows,['data','lancamento','fornecedor','origem','cpf','valor']);
 content+='<p style="font:14px Arial,sans-serif;margin:20px 0 0;">Aguardo retorno para regularização das pendências.</p>';
 const hasAny=dealerRows.length||platformRows.length;
 $('saida').innerHTML=hasAny?content:'<p>Nenhum registro reconhecido. Cole os dados e tente novamente.</p>';
 const platformMissing=Boolean(currentPrint)&&(!platformRows.length||readingPrint);
 $('copiar').disabled=!hasAny||platformMissing;
 $('status').textContent=dealerRows.length+' registro(s) Dealer e '+platformRows.length+' da plataforma.'+(platformMissing?' Plataforma pendente: cópia bloqueada.':'');
}

$('gerar').addEventListener('click',generate);$('limpar').addEventListener('click',()=>{$('dealer').value='';$('plataforma').value='';currentPrint=null;$('print').value='';$('printPreview').classList.add('hidden');$('printPreview').removeAttribute('src');$('extrair').disabled=true;$('ocrStatus').textContent='';$('saida').innerHTML='<p>O modelo padronizado aparecerá aqui depois de clicar em Gerar e-mail.</p>';$('avisos').classList.add('hidden');$('status').textContent='';$('copiar').disabled=true});
$('copiar').addEventListener('click',async()=>{let html='<div><p><b>Assunto:</b> '+escape($('assunto').value)+'</p>'+$('saida').innerHTML+'</div>';let plain='Assunto: '+$('assunto').value+'\n\n'+$('saida').innerText;try{if(navigator.clipboard&&window.ClipboardItem){await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);$('status').textContent='E-mail formatado copiado.'}else{await navigator.clipboard.writeText(plain);$('status').textContent='Texto copiado.'}}catch(e){$('status').textContent='Cópia bloqueada pelo navegador. Selecione o conteúdo da prévia e copie manualmente.'}});})();
