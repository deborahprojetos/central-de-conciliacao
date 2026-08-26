/* V18 - Cruzamento inteligente Itaú x Dealer
   Objetivo: encontrar a baixa mesmo quando o banco agrupa pagamentos
   e o Dealer desmembra títulos, sem depender do número do título.
*/
(() => {
  'use strict';

  const ALIASES = [
    [/VOLKS?WAGEN/i, 'VOLKSWAGEN'],
    [/LM\s+TRANSPORT/i, 'LM'],
    [/RECEITA|DARF|SECRETARIA\s+DA\s+RECEITA/i, 'RECEITA'],
    [/CEF|CAIXA\s+ECONOMICA/i, 'CAIXA'],
    [/SERPRO|SERVICO\s+FEDERAL\s+DE\s+PROCESSAMENTO\s+DE\s+DADOS/i, 'SERPRO'],
    [/DEALERUP/i, 'DEALERUP'],
    [/DEALERSPACE/i, 'DEALERSPACE'],
    [/IPOG|INSTITUTO\s+DE\s+POS/i, 'IPOG'],
    [/OURO\s+VERDE/i, 'OURO VERDE'],
    [/PROTECAO\s+COMERCIO/i, 'PROTECAO'],
  ];

  const STOP = new Set([
    'SA','S','A','S A','LTDA','EIRELI','ME','EPP','DE','DA','DO','DAS','DOS',
    'INDUSTRIA','INDUSTRIAIS','COMERCIO','SERVICOS','SERVICO','EMPRESA',
    'EMPRESARIAL','BRASIL','BR','CIA','COMPANHIA','MATRIZ','FILIAL',
    'THE','AND','E'
  ]);

  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const cents = n => Math.round(Number(n) * 100);
  const abs = n => Math.abs(Number(n));

  function normalize(s) {
    return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  }

  function keyTokens(name) {
    const n = normalize(name);
    for (const [rx, key] of ALIASES) if (rx.test(n)) return new Set([key]);
    return new Set(n.split(' ').filter(t => t.length >= 2 && !STOP.has(t)));
  }

  function nameScore(a,b) {
    const A = keyTokens(a), B = keyTokens(b);
    if (!A.size || !B.size) return 0;
    let hit = 0;
    for (const x of A) if (B.has(x)) hit++;
    return hit / Math.max(A.size, B.size);
  }

  function parseMoney(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return round2(v);
    let s = String(v ?? '').trim().replace(/R\$/gi,'').replace(/\s/g,'');
    if (!s) return NaN;
    const neg = /^-/.test(s) || /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g,'').replace(/^-/,'');
    if (/^\d{1,3}(\.\d{3})*,\d+$/.test(s) || /^\d+,\d+$/.test(s))
      s = s.replace(/\./g,'').replace(',','.');
    else if (/^\d{1,3}(,\d{3})*\.\d+$/.test(s))
      s = s.replace(/,/g,'');
    const n = Number(s);
    return Number.isFinite(n) ? round2(neg ? -n : n) : NaN;
  }

  function dateKey(v) {
    const m = String(v ?? '').match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (!m) return NaN;
    return Date.UTC(+m[3], +m[2]-1, +m[1]) / 86400000;
  }

  function dateDistance(a,b) {
    const A=dateKey(a), B=dateKey(b);
    return Number.isFinite(A)&&Number.isFinite(B) ? Math.abs(A-B) : Infinity;
  }

  function normalizeRows(rows, side) {
    return (rows || []).map((r,i) => ({
      id: r.id || side + (i+1),
      name: String(r.name ?? r.payee ?? r.pagador ?? r.nome ?? '').trim(),
      value: abs(parseMoney(r.value ?? r.valor ?? r['Valor (R$)'] ?? r.TituloValor)),
      date: String(r.date ?? r.data ?? r.TitDataMov ?? '').trim(),
      original: r
    })).filter(r => r.name && Number.isFinite(r.value));
  }

  function total(items) { return round2(items.reduce((s,x)=>s+x.value,0)); }

  /*
   * Procura subconjunto exato com poda.
   * Primeiro privilegia datas próximas; depois tamanho menor.
   * É usado somente para itens ainda não conciliados.
   */
  function findCombination(pool, target, maxSize, tolerance, preferDate) {
    const targetC = cents(target);
    const ordered = pool.slice().sort((a,b) => {
      const ad = preferDate ? dateDistance(preferDate,a.date) : Infinity;
      const bd = preferDate ? dateDistance(preferDate,b.date) : Infinity;
      return ad-bd || Math.abs(b.value-a.value)-Math.abs(a.value-target);
    }).slice(0, 100);

    let best = null;
    const seen = new Set();

    function dfs(start, sum, chosen) {
      const diff = Math.abs(sum-targetC);
      if (chosen.length && diff <= Math.round(tolerance*100)) {
        const ids = chosen.map(x=>x.id).sort().join(',');
        if (!seen.has(ids)) {
          seen.add(ids);
          const datePenalty = chosen.reduce((s,x)=>{
            const d=preferDate ? dateDistance(preferDate,x.date) : 0;
            return s + (Number.isFinite(d) ? d : 2);
          },0);
          const score = diff*1000 + chosen.length*10 + datePenalty;
          if (!best || score < best.score) best={items:chosen.slice(),diff:diff/100,score};
        }
        return;
      }
      if (chosen.length >= maxSize || sum > targetC + Math.round(tolerance*100)) return;

      for (let i=start;i<ordered.length;i++) {
        const v=cents(ordered[i].value);
        const next=sum+v;
        if (next > targetC + Math.round(tolerance*100)) continue;
        dfs(i+1,next,chosen.concat(ordered[i]));
      }
    }

    dfs(0,0,[]);
    return best;
  }

  function exactSingles(I,D,usedI,usedD,matches) {
    const byValue = new Map();
    D.forEach(d=>{
      const k=cents(d.value);
      if(!byValue.has(k)) byValue.set(k,[]);
      byValue.get(k).push(d);
    });

    for(const i of I){
      if(usedI.has(i.id)) continue;
      const candidates=(byValue.get(cents(i.value))||[])
        .filter(d=>!usedD.has(d.id))
        .sort((a,b)=>nameScore(i.name,b.name)-nameScore(i.name,a.name)
          || dateDistance(i.date,a.date)-dateDistance(i.date,b.date));
      if(!candidates.length) continue;

      const d=candidates[0];
      usedI.add(i.id); usedD.add(d.id);
      const sim=nameScore(i.name,d.name);
      matches.push({
        itau:[i], dealer:[d], status:'CONCILIADO',
        type:sim>=0.25?'Valor + nome aproximado':'Valor exato',
        difference:0, confidence:sim
      });
    }
  }

  function groupedOneToMany(I,D,usedI,usedD,matches) {
    for(const i of I){
      if(usedI.has(i.id)) continue;

      const pool=D.filter(d=>!usedD.has(d.id));
      if(!pool.length) continue;

      // Primeiro: candidatos semanticamente relacionados.
      const related=pool.filter(d=>nameScore(i.name,d.name)>=0.25);
      let combo=findCombination(related,i.value,8,0.01,i.date);

      let type='Agrupamento 1×N por nome + valor';

      // Segundo: se o nome não ajudar, procura a soma no conjunto geral,
      // respeitando proximidade de data. Isso captura BANCO VOLKSWAGEN -> LM.
      if(!combo){
        const nearDate=pool.filter(d=>{
          const dd=dateDistance(i.date,d.date);
          return !Number.isFinite(dd) || dd<=3;
        });
        combo=findCombination(nearDate,i.value,8,0.01,i.date);
        if(combo) type='Agrupamento 1×N por valor/data';
      }

      if(combo){
        combo.items.forEach(d=>usedD.add(d.id));
        usedI.add(i.id);
        const sim=Math.max(0,...combo.items.map(d=>nameScore(i.name,d.name)));
        matches.push({
          itau:[i], dealer:combo.items, status:'CONCILIADO',
          type, difference:0, confidence:sim
        });
      }
    }
  }

  function groupedManyToOne(I,D,usedI,usedD,matches) {
    for(const d of D){
      if(usedD.has(d.id)) continue;
      const pool=I.filter(i=>!usedI.has(i.id));
      const related=pool.filter(i=>nameScore(i.name,d.name)>=0.25);
      let combo=findCombination(related,d.value,8,0.01,d.date);
      let type='Agrupamento N×1 por nome + valor';

      if(!combo){
        const nearDate=pool.filter(i=>{
          const dd=dateDistance(i.date,d.date);
          return !Number.isFinite(dd)||dd<=3;
        });
        combo=findCombination(nearDate,d.value,8,0.01,d.date);
        if(combo) type='Agrupamento N×1 por valor/data';
      }

      if(combo){
        combo.items.forEach(i=>usedI.add(i.id));
        usedD.add(d.id);
        const sim=Math.max(0,...combo.items.map(i=>nameScore(i.name,d.name)));
        matches.push({
          itau:combo.items, dealer:[d], status:'CONCILIADO',
          type, difference:0, confidence:sim
        });
      }
    }
  }

  function differences(I,D,usedI,usedD,out) {
    for(const i of I){
      if(usedI.has(i.id)) continue;
      const candidates=D.filter(d=>!usedD.has(d.id))
        .map(d=>({d,sim:nameScore(i.name,d.name),dd:dateDistance(i.date,d.date),diff:abs(i.value-d.value)}))
        .filter(x=>x.sim>=0.25 && (!Number.isFinite(x.dd)||x.dd<=3))
        .sort((a,b)=>a.diff-b.diff || b.sim-a.sim || a.dd-b.dd);

      if(candidates.length){
        const c=candidates[0];
        usedI.add(i.id); usedD.add(c.d.id);
        out.push({
          itau:[i],dealer:[c.d],status:'DIVERGENCIA',
          type:'Nome relacionado + valor diferente',
          difference:round2(i.value-c.d.value),confidence:c.sim
        });
      }
    }
  }

  function reconcile(itauInput,dealerInput,options={}) {
    const I=normalizeRows(itauInput,'I');
    const D=normalizeRows(dealerInput,'D');
    const usedI=new Set(), usedD=new Set();
    const matches=[], diffs=[];

    exactSingles(I,D,usedI,usedD,matches);
    groupedOneToMany(I,D,usedI,usedD,matches);
    groupedManyToOne(I,D,usedI,usedD,matches);
    differences(I,D,usedI,usedD,diffs);

    const itauSem=I.filter(i=>!usedI.has(i.id)).map(i=>({
      itau:[i],dealer:[],status:'ITAU_SEM_DEALER',
      type:'Nenhuma correspondência encontrada',difference:round2(i.value)
    }));
    const dealerSem=D.filter(d=>!usedD.has(d.id)).map(d=>({
      itau:[],dealer:[d],status:'DEALER_SEM_ITAU',
      type:'Nenhuma correspondência encontrada',difference:round2(-d.value)
    }));

    return {
      matches,differences:diffs,itauSem,dealerSem,
      all:[...matches,...diffs,...itauSem,...dealerSem],
      totals:{
        itauCount:I.length,
        itauValue:total(I),
        dealerCount:D.length,
        dealerValue:total(D)
      }
    };
  }

  window.IntelligentReconciler={reconcile,normalize,nameScore,parseMoney};
})();
