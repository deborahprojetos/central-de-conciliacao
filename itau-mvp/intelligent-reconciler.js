/* MVP - Motor de Conciliação Itaú x Dealer
 * Regras:
 * 1) 1x1 por valor
 * 2) 1xN / Nx1 por soma
 * 3) nomes aproximados por tokens relevantes
 * 4) datas com tolerância operacional
 * 5) divergência separada de não localizado
 * 6) não força correspondência
 */
(function (root) {
  'use strict';

  const STOP = new Set([
    'SA','S.A','LTDA','EIRELI','ME','EPP','DE','DA','DO','DAS','DOS',
    'INDUSTRIA','INDUSTRIAIS','COMERCIO','COMERCIO E SERVICOS',
    'SERVICOS','SERVICO','EMPRESA','EMPRESARIAL','BRASIL','BR',
    'CIA','COMPANHIA','BANCO','FUNDO','SAO','SANTA'
  ]);

  const ALIASES = [
    [/volkswagen/i, 'VOLKSWAGEN'],
    [/lm\\s+transport/i, 'LM'],
    [/receita|darf|secretaria\\s+da\\s+receita/i, 'RECEITA'],
    [/cef|caixa\\s+economica/i, 'CAIXA'],
    [/serpro/i, 'SERPRO'],
    [/dealerspace/i, 'DEALERSPACE'],
    [/dealerup/i, 'DEALERUP']
  ];

  function round2(v) { return Math.round((Number(v) + Number.EPSILON) * 100) / 100; }
  function money(v) {
    if (typeof v === 'number') return round2(v);
    let s = String(v ?? '').replace(/R\\$/gi, '').replace(/\\s/g, '').trim();
    if (!s) return NaN;
    s = s.replace(/[()]/g, '');
    let neg = /^-/.test(s);
    s = s.replace(/^-/, '');
    if (/\\d{1,3}(\\.\\d{3})*,\\d{2}$/.test(s) || /^\\d+,\\d{2}$/.test(s)) s = s.replace(/\\./g,'').replace(',','.');
    else if (/\\d{1,3}(,\\d{3})*\\.\\d{2}$/.test(s)) s = s.replace(/,/g,'');
    const n = Number(s);
    return Number.isFinite(n) ? round2(neg ? -n : n) : NaN;
  }
  function normalize(s) {
    return String(s ?? '').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'')
      .toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\\s+/g,' ').trim();
  }
  function tokens(name) {
    const n = normalize(name);
    for (const [rx, key] of ALIASES) if (rx.test(n)) return new Set([key]);
    return new Set(n.split(' ').filter(x => x.length >= 2 && !STOP.has(x)));
  }
  function similarity(a,b) {
    const A=tokens(a), B=tokens(b);
    if (!A.size || !B.size) return 0;
    let hit=0; for (const x of A) if (B.has(x)) hit++;
    return hit / Math.max(A.size,B.size);
  }
  function day(s) {
    const m=String(s??'').match(/(\\d{1,2})[\\/-](\\d{1,2})[\\/-](\\d{4})/);
    if(!m) return NaN;
    return Date.UTC(+m[3],+m[2]-1,+m[1])/86400000;
  }
  function dateDistance(a,b) {
    const A=day(a),B=day(b);
    return Number.isFinite(A)&&Number.isFinite(B)?Math.abs(A-B):Infinity;
  }

  function combinations(items, maxSize, target, tolerance, maxCandidates=80) {
    const out=[];
    const sorted=items.slice().sort((a,b)=>Math.abs(a.value-target)-Math.abs(b.value-target)).slice(0,maxCandidates);
    function walk(start, chosen, sum) {
      if (chosen.length > maxSize) return;
      const diff=Math.abs(round2(sum-target));
      if (chosen.length && diff <= tolerance) { out.push({items:chosen.slice(),diff}); return; }
      if (chosen.length === maxSize) return;
      for(let i=start;i<sorted.length;i++) {
        const next=round2(sum+sorted[i].value);
        if (next > target+tolerance) continue;
        walk(i+1, chosen.concat(sorted[i]), next);
      }
    }
    walk(0,[],0);
    out.sort((a,b)=>a.diff-b.diff || a.items.length-b.items.length);
    return out[0] || null;
  }

  function makeRows(rows, side) {
    return (rows||[]).map((r,i)=>({
      id: r.id || side[0]+(i+1),
      name: String(r.name ?? r.payee ?? r.pagador ?? r.nome ?? '').trim(),
      value: Math.abs(money(r.value ?? r.valor ?? r['Valor (R$)'] ?? r.TituloValor)),
      date: String(r.date ?? r.data ?? r.dataPagamento ?? r['Data'] ?? '').trim(),
      original:r
    })).filter(r=>r.name && Number.isFinite(r.value));
  }

  function reconcile(itauInput, dealerInput, options={}) {
    const tolerance = options.tolerance ?? 0.01;
    const nameThreshold = options.nameThreshold ?? 0.25;
    const maxGroup = options.maxGroup ?? 6;

    const I=makeRows(itauInput,'I');
    const D=makeRows(dealerInput,'D');
    const usedI=new Set(), usedD=new Set();
    const matches=[], differences=[];

    function score(i, ds) {
      const total=round2(ds.reduce((s,x)=>s+x.value,0));
      const diff=round2(i.value-total);
      const sims=ds.map(d=>similarity(i.name,d.name));
      const sim=Math.max(...sims,0);
      const dd=Math.min(...ds.map(d=>dateDistance(i.date,d.date)),Infinity);
      return {total,diff,sim,dd};
    }

    // Passo 1: 1x1 por valor e nome/data.
    for (const i of I) {
      const candidates=D.filter(d=>!usedD.has(d.id) && Math.abs(d.value-i.value)<=tolerance)
        .map(d=>({d,sim:similarity(i.name,d.name),dd:dateDistance(i.date,d.date)}))
        .sort((a,b)=>b.sim-a.sim || a.dd-b.dd);
      if(candidates.length && (candidates[0].sim>=nameThreshold || candidates[0].dd<=1 || candidates.length===1)){
        const d=candidates[0].d; usedI.add(i.id); usedD.add(d.id);
        matches.push({itau:[i],dealer:[d],status:'CONCILIADO',type:'1x1',difference:0,confidence:candidates[0].sim});
      }
    }

    // Passo 2: Itaú 1xN, somando Dealer.
    for (const i of I) {
      if(usedI.has(i.id)) continue;
      const pool=D.filter(d=>!usedD.has(d.id));
      const related=pool.filter(d=>similarity(i.name,d.name)>=nameThreshold || tokens(i.name).size && [...tokens(i.name)].some(t=>tokens(d.name).has(t)));
      const candidates=related.length?related:pool;
      const combo=combinations(candidates, maxGroup, i.value, tolerance);
      if(combo){
        const s=score(i,combo.items);
        const nameOk=s.sim>=nameThreshold || combo.items.some(d=>similarity(i.name,d.name)>=nameThreshold);
        if(nameOk || combo.items.length>1){
          combo.items.forEach(d=>usedD.add(d.id)); usedI.add(i.id);
          matches.push({itau:[i],dealer:combo.items,status:'CONCILIADO',type:'1xN',difference:0,confidence:s.sim});
        }
      }
    }

    // Passo 3: Dealer 1xN contra vários Itaú.
    for (const d of D) {
      if(usedD.has(d.id)) continue;
      const pool=I.filter(i=>!usedI.has(i.id));
      const related=pool.filter(i=>similarity(i.name,d.name)>=nameThreshold || [...tokens(d.name)].some(t=>tokens(i.name).has(t)));
      const candidates=related.length?related:pool;
      const combo=combinations(candidates,maxGroup,d.value,tolerance);
      if(combo){
        const sim=Math.max(...combo.items.map(i=>similarity(i.name,d.name)),0);
        if(sim>=nameThreshold || combo.items.length>1){
          combo.items.forEach(i=>usedI.add(i.id)); usedD.add(d.id);
          matches.push({itau:combo.items,dealer:[d],status:'CONCILIADO',type:'Nx1',difference:0,confidence:sim});
        }
      }
    }

    // Passo 4: encontra provável correspondência com diferença de valor.
    for (const i of I) {
      if(usedI.has(i.id)) continue;
      const cand=D.filter(d=>!usedD.has(d.id))
        .map(d=>({d,sim:similarity(i.name,d.name),dd:dateDistance(i.date,d.date),diff:Math.abs(i.value-d.value)}))
        .filter(x=>x.sim>=nameThreshold && x.dd<=3)
        .sort((a,b)=>a.diff-b.diff || b.sim-a.sim)[0];
      if(cand){
        usedI.add(i.id); usedD.add(cand.d.id);
        differences.push({itau:[i],dealer:[cand.d],status:'DIVERGENCIA',type:'1x1',difference:round2(i.value-cand.d.value),confidence:cand.sim});
      }
    }

    const itauSem=I.filter(x=>!usedI.has(x.id)).map(i=>({itau:[i],dealer:[],status:'ITAU_SEM_DEALER',difference:i.value}));
    const dealerSem=D.filter(x=>!usedD.has(x.id)).map(d=>({itau:[],dealer:[d],status:'DEALER_SEM_ITAU',difference:-d.value}));

    return {
      totals:{
        itauCount:I.length, dealerCount:D.length,
        itauValue:round2(I.reduce((s,x)=>s+x.value,0)),
        dealerValue:round2(D.reduce((s,x)=>s+x.value,0))
      },
      matches, differences, itauSem, dealerSem,
      all:[...matches,...differences,...itauSem,...dealerSem]
    };
  }

  root.IntelligentReconciler = { reconcile, money, normalize, similarity };
})(typeof window!=='undefined'?window:this);
