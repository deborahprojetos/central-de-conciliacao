(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReconcilerCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONEY_TOLERANCE = 0.011;

  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u00a0/g, ' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function onlyDigits(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function normalizeId(value) {
    const digits = onlyDigits(value);
    if (!digits) return '';
    return digits.replace(/^0+(?=\d)/, '');
  }

  function parseMoneyBR(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    let s = String(value ?? '').trim();
    if (!s) return NaN;
    s = s.replace(/R\$/gi, '').replace(/\s/g, '');
    const negative = /^-/.test(s) || /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g, '').replace(/^-/, '');

    if (/^\d{1,3}(\.\d{3})*,\d+$/.test(s) || /^\d+,\d+$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(,\d{3})*\.\d+$/.test(s)) {
      s = s.replace(/,/g, '');
    } else if (/^\d+(\.\d+)?$/.test(s)) {
      // already JS-like
    } else {
      const m = s.match(/[\d.]+,\d{2}|\d+(?:\.\d{2})?/);
      if (!m) return NaN;
      return parseMoneyBR((negative ? '-' : '') + m[0]);
    }
    const n = Number(s);
    return negative ? -n : n;
  }

  function formatDateBR(value) {
    if (!value) return '';
    if (value instanceof Date && !isNaN(value)) {
      return String(value.getDate()).padStart(2, '0') + '/' + String(value.getMonth() + 1).padStart(2, '0') + '/' + value.getFullYear();
    }
    const s = String(value).trim();
    let m = s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
    if (m) {
      let year = m[3];
      if (year.length === 2) year = '20' + year;
      return m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + year;
    }
    // Excel ISO / JS date-like string
    const d = new Date(s);
    if (!isNaN(d)) return formatDateBR(d);
    return '';
  }

  function parseBankTitle(seuNumero) {
    const digits = onlyDigits(seuNumero);
    if (!digits) return { note: '', installment: '' };

    // O relatório do Itaú normalmente grava "Seu número" como:
    // [título do Dealer] + [parcela com 3 dígitos].
    // Ex.: 0398607004 -> título 398607 / parcela 004.
    // Há exceções em que o banco traz somente o título (ex.: 399753).
    if (digits.length <= 6) return { note: normalizeId(digits), installment: '' };

    return {
      note: normalizeId(digits.slice(0, -3)),
      installment: digits.slice(-3)
    };
  }

  function detectHeaders(matrix) {
    const maxRows = Math.min(matrix.length, 60);
    for (let r = 0; r < maxRows; r++) {
      const normalized = (matrix[r] || []).map(normalizeText);
      const payee = normalized.findIndex(v => v.includes('pagador'));

      // "Nosso número" e "Seu número" aparecem lado a lado. A conciliação
      // deve usar exclusivamente "Seu número".
      let yourNumber = normalized.findIndex(v =>
        v.includes('seu numero') || v === 'seu n' || v.startsWith('seu n') || v.includes('seu nº')
      );

      const value = normalized.findIndex(v => v === 'valor(r$)' || v === 'valor' || v.startsWith('valor '));
      const date = normalized.findIndex(v => v.includes('data de baixa') || v.includes('liquidacao') || v.includes('data baixa'));
      if (payee >= 0 && yourNumber >= 0 && value >= 0) {
        return { row: r, payee, yourNumber, value, date };
      }
    }
    throw new Error('Não encontrei as colunas Pagador, Valor e Seu número no arquivo do Itaú. Confira se o relatório é “Boletos baixados e liquidados”.');
  }

  function extractItauRows(matrix) {
    const header = detectHeaders(matrix);
    const out = [];
    let sequence = 0;

    for (let r = header.row + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      const payee = String(row[header.payee] ?? '').trim();
      const yourNumber = String(row[header.yourNumber] ?? '').trim();
      const value = parseMoneyBR(row[header.value]);
      const date = header.date >= 0 ? formatDateBR(row[header.date]) : '';
      const history = String(row.find ? '' : '').trim();
      if (!payee && !yourNumber && !Number.isFinite(value)) continue;
      if (!payee || !yourNumber || !Number.isFinite(value)) continue;

      const { note, installment } = parseBankTitle(yourNumber);
      if (!note) continue;

      out.push({
        id: 'I' + (++sequence),
        sourceRow: r + 1,
        payee,
        yourNumber,
        note,
        installment,
        date,
        value: Math.round(value * 100) / 100,
        status: history.toLowerCase().includes('liquid') ? 'Liquidado' : (history.toLowerCase().includes('baix') ? 'Baixado' : '')
      });
    }

    if (!out.length) throw new Error('O arquivo do Itaú foi aberto, mas nenhum recebimento válido foi encontrado.');
    return out;
  }

  function cleanDealerCell(value) {
    let s = String(value ?? '').trim();
    // Markdown link: [**398313**](javascript:...)
    const md = s.match(/^\[\*{0,2}([^\]]+?)\*{0,2}\]\([^)]*\)/);
    if (md) s = md[1];
    return s
      .replace(/\*\*/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function classifyDealerType(value) {
    const s = normalizeText(value);
    if (s.includes('recebimento de titulo')) return 'receipt';
    if (s.includes('juros cobrado') || s.includes('juros receb')) return 'interest';
    if (s.includes('desconto')) return 'discount';
    if (s.includes('abatimento')) return 'discount';
    if (s.includes('multa cobrada') || s.includes('multa receb')) return 'interest';
    return '';
  }

  function extractDatesFromCells(cells) {
    const dates = [];
    cells.forEach(c => {
      const m = String(c).match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g);
      if (m) dates.push(...m.map(formatDateBR));
    });
    return dates;
  }

  function dateToUtcDay(value) {
    const s = formatDateBR(value);
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return NaN;
    return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) / 86400000;
  }

  function dayDiff(fromDate, toDate) {
    const a = dateToUtcDay(fromDate);
    const b = dateToUtcDay(toDate);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round(b - a) : NaN;
  }

  function parseDealerLine(line, seq) {
    let cells;
    if (line.includes('|')) {
      cells = line.split('|').map(cleanDealerCell).filter((c, idx, arr) => !(c === '' && (idx === 0 || idx === arr.length - 1)));
    } else if (line.includes('\t')) {
      cells = line.split('\t').map(cleanDealerCell);
    } else {
      cells = [cleanDealerCell(line)];
    }

    const combined = cells.join(' | ');
    const type = classifyDealerType(combined);
    if (!type) return null;

    // Prefer the first cell for Nota Fiscal. Fall back to first long numeric token.
    let noteMatch = (cells[0] || '').match(/\b\d{3,}\b/);
    if (!noteMatch) noteMatch = combined.match(/\b\d{3,}\b/);
    if (!noteMatch) return null;
    const note = normalizeId(noteMatch[0]);

    const dates = extractDatesFromCells(cells);
    // Ordem da grade Dealer: Dt. Caixa, depois Dt. Movimento.
    const cashDate = dates[0] || '';
    const movementDate = dates[1] || '';
    const date = cashDate || movementDate;

    // In Dealer table the first three numeric cells are Nota Fiscal, Movimento and Lançamento.
    const numericCells = cells
      .slice(0, Math.min(cells.length, 5))
      .map(c => (String(c).match(/^\D*(\d{3,})\D*$/) || [])[1])
      .filter(Boolean);
    const movement = numericCells[1] ? normalizeId(numericCells[1]) : '';
    const launch = numericCells[2] ? normalizeId(numericCells[2]) : '';

    // Prefer final cell as the monetary value; otherwise take the last Brazilian decimal token.
    let value = parseMoneyBR(cells[cells.length - 1]);
    if (!Number.isFinite(value)) {
      const matches = combined.match(/-?[\d.]+,\d{2}\b/g) || [];
      if (matches.length) value = parseMoneyBR(matches[matches.length - 1]);
    }
    if (!Number.isFinite(value)) return null;

    return {
      id: 'DR' + seq, note, movement, launch, date, cashDate, movementDate, type,
      value: Math.abs(value), raw: line
    };
  }

  function parseDealerText(text) {
    const lines = String(text ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const entries = [];
    let seq = 0;
    for (const line of lines) {
      const parsed = parseDealerLine(line, ++seq);
      if (parsed) entries.push(parsed);
    }
    if (!entries.length) throw new Error('Não consegui identificar movimentos válidos no texto do Dealer. Cole as linhas da grade “Movimentos em Títulos”.');
    return entries;
  }

  function groupDealerEntries(entries) {
    const groups = [];
    const byKey = new Map();
    let fallbackSeq = 0;

    for (const e of entries) {
      // Lançamento identifies components (receipt/interest/discount) of the same Dealer transaction.
      let key;
      if (e.launch) key = e.note + '|L' + e.launch;
      else if (e.movement) key = e.note + '|M' + e.movement;
      else key = e.note + '|D' + (e.date || '') + '|F' + (++fallbackSeq);

      let g = byKey.get(key);
      if (!g) {
        g = {
          id: 'DG' + (groups.length + 1), key, note: e.note, movement: e.movement, launch: e.launch,
          date: e.date, cashDate: e.cashDate || e.date || '', movementDate: e.movementDate || '',
          receipt: 0, interest: 0, discount: 0, entries: [], used: false
        };
        byKey.set(key, g);
        groups.push(g);
      }
      g.entries.push(e);
      if (!g.date && e.date) g.date = e.date;
      if (!g.cashDate && e.cashDate) g.cashDate = e.cashDate;
      if (!g.movementDate && e.movementDate) g.movementDate = e.movementDate;
      if (!g.movement && e.movement) g.movement = e.movement;
      if (!g.launch && e.launch) g.launch = e.launch;
      if (e.type === 'receipt') g.receipt += e.value;
      else if (e.type === 'interest') g.interest += e.value;
      else if (e.type === 'discount') g.discount += e.value;
    }

    for (const g of groups) {
      g.receipt = round2(g.receipt);
      g.interest = round2(g.interest);
      g.discount = round2(g.discount);
      g.total = round2(g.receipt + g.interest - g.discount);
    }
    return groups;
  }

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function dealerDateScore(bankRow, group) {
    if (!bankRow.date) return 20;

    // No fluxo real, a Data de baixa/liquidação do Itaú costuma ser a Dt. Movimento
    // do Dealer. Já a Dt. Caixa do Dealer aparece no dia seguinte.
    if (group.movementDate && group.movementDate === bankRow.date) return 0;

    const cashDiff = dayDiff(bankRow.date, group.cashDate || group.date);
    if (cashDiff === 1) return 1; // cenário esperado: Itaú D -> Dealer D+1
    if (cashDiff === 0) return 2;
    if (cashDiff > 1 && cashDiff <= 3) return 3 + cashDiff; // fim de semana/virada operacional

    const movDiff = Math.abs(dayDiff(bankRow.date, group.movementDate));
    if (Number.isFinite(movDiff) && movDiff <= 1) return 8 + movDiff;
    return 50;
  }

  function chooseDealerGroup(bankRow, groups) {
    // Regra principal Itaú x Dealer: o Seu Número do Itaú corresponde ao
    // Lançamento do Dealer. Alguns relatórios também permitem o fallback
    // pela Nota Fiscal normalizada (sem os 3 dígitos da parcela).
    const yourNumber = normalizeId(bankRow.yourNumber || '');
    const candidates = groups.filter(g => !g.used && (
      (yourNumber && g.launch === yourNumber) ||
      (bankRow.note && g.note === bankRow.note)
    ));
    if (!candidates.length) return { group: null, dateFallback: false, dateRelation: 'missing' };

    const ranked = candidates.map(g => ({
      g,
      amountDiff: Math.abs(round2(bankRow.value - g.total)),
      dateScore: dealerDateScore(bankRow, g),
      launchMatch: yourNumber && g.launch === yourNumber ? 0 : 1
    })).sort((a, b) => {
      const aExact = a.amountDiff < MONEY_TOLERANCE ? 0 : 1;
      const bExact = b.amountDiff < MONEY_TOLERANCE ? 0 : 1;
      return a.launchMatch - b.launchMatch || aExact - bExact || a.amountDiff - b.amountDiff || a.dateScore - b.dateScore;
    });

    const best = ranked[0];
    let dateRelation = 'different';
    if (best.g.movementDate && best.g.movementDate === bankRow.date) dateRelation = 'movement_same_day';
    else {
      const d = dayDiff(bankRow.date, best.g.cashDate || best.g.date);
      if (d === 1) dateRelation = 'cash_next_day';
      else if (d === 0) dateRelation = 'cash_same_day';
      else if (Number.isFinite(d) && d > 1 && d <= 3) dateRelation = 'cash_later';
    }

    return { group: best.g, dateFallback: best.dateScore >= 50, dateRelation };
  }

  function reconcile(itauRows, dealerTextOrEntries) {
    const dealerEntries = Array.isArray(dealerTextOrEntries) ? dealerTextOrEntries : parseDealerText(dealerTextOrEntries);
    const dealerGroups = groupDealerEntries(dealerEntries);
    const results = [];

    for (const bank of itauRows) {
      const { group, dateFallback, dateRelation } = chooseDealerGroup(bank, dealerGroups);
      if (!group) {
        results.push({
          ...bank, dealerGroupId: '', dealerValue: null, dealerAdjusted: null, difference: bank.value, finalDifference: bank.value,
          receipt: 0, interest: 0, discount: 0,
          status: 'missing', reason: 'Não localizado no Dealer', dateFallback: false, dateRelation: 'missing'
        });
        continue;
      }

      group.used = true;
      const rawDiff = round2(bank.value - group.receipt);
      const diff = round2(bank.value - group.total);
      let status = 'ok';
      let reason = 'Conciliado';
      const hasInterest = group.interest > MONEY_TOLERANCE;
      const hasDiscount = group.discount > MONEY_TOLERANCE;

      if (Math.abs(diff) >= MONEY_TOLERANCE) {
        status = 'difference';
        reason = 'Valor diferente';
        if (hasInterest || hasDiscount) reason += ' mesmo após os ajustes';
      } else if (hasInterest && hasDiscount) {
        status = 'adjustment'; reason = 'Conciliado com juros e desconto';
      } else if (hasInterest) {
        status = 'adjustment'; reason = 'Conciliado com juros';
      } else if (hasDiscount) {
        status = 'adjustment'; reason = 'Conciliado com desconto';
      }
      // Itaú D -> Dealer D+1 é esperado e não deve ser marcado como divergência.
      if (dateFallback && status === 'ok') { status = 'adjustment'; reason = 'Conciliado, mas confira a data'; }
      else if (dateFallback) reason += ' · confira a data';

      results.push({
        ...bank,
        dealerGroupId: group.id,
        dealerValue: group.receipt,
        dealerPrincipal: group.receipt,
        dealerAdjusted: group.total,
        totalReceivedItau: bank.value,
        adjustmentValue: round2(group.interest - group.discount),
        dealerDate: group.cashDate || group.date,
        dealerMovementDate: group.movementDate || '',
        dateRelation,
        movement: group.movement,
        launch: group.launch,
        difference: rawDiff,
        finalDifference: diff,
        receipt: group.receipt,
        interest: group.interest,
        discount: group.discount,
        status, reason, dateFallback
      });
    }

    const dealerOnly = dealerGroups.filter(g => !g.used).map(g => ({
      id: g.id,
      payee: '', note: g.note, installment: '', date: g.cashDate || g.date,
      dealerMovementDate: g.movementDate || '',
      value: null, totalReceivedItau: null, dealerValue: g.receipt, dealerPrincipal: g.receipt, dealerAdjusted: g.total,
      adjustmentValue: round2(g.interest - g.discount), difference: -g.receipt, finalDifference: -g.total,
      receipt: g.receipt, interest: g.interest, discount: g.discount,
      status: 'dealerOnly', reason: 'Movimento existe somente no Dealer', movement: g.movement, launch: g.launch
    }));

    return { results, dealerGroups, dealerOnly };
  }



  // ===== MODO PAGAMENTOS: Itaú pagamentos x Dealer títulos =====
  // O Itaú informa a data em que o débito ocorreu; o Dealer informa a data do movimento
  // e, quando disponível, a Dt. Caixa. Este modo não depende de OCR.
  function detectPaymentHeaders(matrix) {
    const maxRows = Math.min(matrix.length, 80);
    for (let r = 0; r < maxRows; r++) {
      const h = (matrix[r] || []).map(normalizeText);
      const date = h.findIndex(v => v === 'v' || v === 'data' || v.includes('data') || v.includes('dt pagamento'));
      const name = h.findIndex(v => v.includes('razao social') || v.includes('nome') || v.includes('favorecido') || v.includes('beneficiario'));
      const value = h.findIndex(v => v.includes('valor'));
      if (date >= 0 && name >= 0 && value >= 0) return { row:r, date, name, value };
    }
    throw new Error('Não encontrei Data, Razão Social/Nome e Valor no arquivo de pagamentos do Itaú.');
  }

  function extractItauPaymentRows(matrix) {
    const h = detectPaymentHeaders(matrix);
    const out=[]; let seq=0;
    for(let r=h.row+1;r<matrix.length;r++){
      const row=matrix[r]||[];
      const name=String(row[h.name]??'').trim();
      const date=formatDateBR(row[h.date]);
      const value=Math.abs(parseMoneyBR(row[h.value]));
      if(!name || !date || !Number.isFinite(value) || value===0) continue;
      const id='IP'+(++seq);
      out.push({id,sourceRow:r+1,payee:name,date,value:round2(value),note:'',yourNumber:'',installment:''});
    }
    if(!out.length) throw new Error('O arquivo de pagamentos do Itaú foi aberto, mas nenhum pagamento válido foi encontrado.');
    return out;
  }

  function detectDealerExcelHeaders(matrix) {
    const maxRows=Math.min(matrix.length,80);
    for(let r=0;r<maxRows;r++){
      const h=(matrix[r]||[]).map(normalizeText);
      const name=h.findIndex(v=>v.includes('titulopessoanome') || v.includes('pessoa nome') || v.includes('beneficiario') || v.includes('sacado'));
      const value=h.findIndex(v=>v.includes('titulovalor') || v==='valor' || v.includes('valor titulo'));
      const movement=h.findIndex(v=>v.includes('titdatamov') || v.includes('data movimento') || v.includes('dt movimento'));
      const cash=h.findIndex(v=>v.includes('titmovdatacaixa') || v.includes('data caixa') || v.includes('dt caixa'));
      const parcel=h.findIndex(v=>v.includes('titulonumeroparcela') || v.includes('numero parcela') || v.includes('nº parcela'));
      const note=h.findIndex(v=>v.includes('titulocodigo') || v.includes('nota fiscal') || v==='nota');
      const hist=h.findIndex(v=>v.includes('titulohistorico') || v.includes('historico'));
      if(name>=0 && value>=0 && (movement>=0 || cash>=0)) return {row:r,name,value,movement,cash,parcel,note,hist};
    }
    throw new Error('Não encontrei as colunas de Pessoa, Valor e Data de Movimento/Caixa no arquivo do Dealer.');
  }

  function extractDealerExcelRows(matrix) {
    const h=detectDealerExcelHeaders(matrix); const out=[]; let seq=0;
    for(let r=h.row+1;r<matrix.length;r++){
      const row=matrix[r]||[];
      const name=String(row[h.name]??'').trim();
      const value=Math.abs(parseMoneyBR(row[h.value]));
      const movement=h.movement>=0?formatDateBR(row[h.movement]):'';
      const cash=h.cash>=0?formatDateBR(row[h.cash]):'';
      if(!name || !Number.isFinite(value) || value===0 || (!movement&&!cash)) continue;
      const hist=h.hist>=0?String(row[h.hist]??''):'PAGAMENTO DE TITULOS';
      const type=classifyDealerType(hist) || 'receipt';
      const noteRaw=h.parcel>=0?String(row[h.parcel]??''):'';
      const note=h.note>=0?normalizeId(row[h.note]):(noteRaw.match(/\d{3,}/)?.[0] ? normalizeId(noteRaw.match(/\d{3,}/)[0]) : '');
      out.push({id:'DEX'+(++seq),note,movementDate:movement,cashDate:cash,date:movement||cash,type,value,raw:row,name,parcel:noteRaw,history:hist});
    }
    if(!out.length) throw new Error('O arquivo do Dealer foi aberto, mas nenhum título válido foi encontrado.');
    return out;
  }

  function normalizePartyKey(s){
    const n=normalizeText(s);
    const aliases=[
      [/petroforte|petrofort/i,'petrofort'],[/soma marketing|soma promo/i,'soma promo'],
      [/m cabral infoprodutora|marcilio dener cabral/i,'marcilio cabral'],
      [/caixa economica federal|cef/i,'caixa'],[/receita|darf|secretaria da receita/i,'receita'],
      [/serpro|servico federal de processamento de dados/i,'serpro'],
      [/dealerup/i,'dealerup'],[/dealerspace/i,'dealerspace'],[/algar/i,'algar'],
      [/lm transport/i,'lm transport'],[/volkswagen/i,'volkswagen'],[/mr despachante|costa almeida despachante/i,'despachante']
    ];
    for(const [rx,k] of aliases) if(rx.test(n)) return k;
    return n;
  }

  function partySimilarity(a,b){
    const A=new Set(normalizePartyKey(a).split(/\s+/).filter(x=>x.length>=3));
    const B=new Set(normalizePartyKey(b).split(/\s+/).filter(x=>x.length>=3));
    if(!A.size||!B.size) return 0;
    let hit=0; for(const x of A) if(B.has(x)) hit++;
    return hit/Math.max(A.size,B.size);
  }

  function paymentCombinations(items,target,maxSize=20,tolerance=MONEY_TOLERANCE){
    // Backtracking limitado e orientado por proximidade. Adequado para grupos bancários,
    // como o crédito/pagamento de R$ 1.034.212,00 formado por vários títulos LM.
    const sorted=items.slice().sort((a,b)=>Math.abs(a.value-target)-Math.abs(b.value-target));
    const out=[];
    function walk(start,chosen,sum){
      if(chosen.length>maxSize) return;
      const diff=Math.abs(round2(sum-target));
      if(chosen.length && diff<tolerance){ out.push({items:chosen.slice(),diff}); return; }
      if(chosen.length===maxSize || sum>target+tolerance) return;
      for(let i=start;i<sorted.length;i++){
        const next=round2(sum+sorted[i].value);
        if(next>target+tolerance) continue;
        walk(i+1,chosen.concat(sorted[i]),next);
        if(out.length>=3) return;
      }
    }
    walk(0,[],0);
    out.sort((a,b)=>a.diff-b.diff||a.items.length-b.items.length);
    return out[0]||null;
  }


  function findExactPartyGroup(target, pool, tolerance=MONEY_TOLERANCE) {
    const buckets = new Map();
    for (const d of pool) {
      const key = normalizePartyKey(d.name);
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(d);
    }
    const hits=[];
    for (const [key, items] of buckets) {
      const sum=round2(items.reduce((s,d)=>s+d.value,0));
      if (Math.abs(sum-target)<tolerance) hits.push({key,items,diff:round2(target-sum)});
    }
    return hits.sort((a,b)=>a.items.length-b.items.length)[0]||null;
  }

  function reconcilePayments(itauRows,dealerRows,options={}){
    const tolerance=options.tolerance??MONEY_TOLERANCE;
    const maxGroup=options.maxGroup??20;
    const I=itauRows.map(x=>({...x,value:Math.abs(round2(x.value))})).filter(x=>Number.isFinite(x.value)&&x.value>0);
    const D=dealerRows.map(x=>({...x,value:Math.abs(round2(x.value))})).filter(x=>Number.isFinite(x.value)&&x.value>0);
    const usedI=new Set(), usedD=new Set(), results=[];
    const dateScore=(i,d)=>{
      const md=dayDiff(i.date,d.movementDate||d.date); const cd=dayDiff(i.date,d.cashDate);
      if(Number.isFinite(md)&&md===0) return {score:0,relation:'movimento_mesmo_dia'};
      if(Number.isFinite(cd)&&cd===1) return {score:1,relation:'caixa_dia_seguinte'};
      if(Number.isFinite(cd)&&cd===0) return {score:2,relation:'caixa_mesmo_dia'};
      if(Number.isFinite(md)&&Math.abs(md)<=1) return {score:4+Math.abs(md),relation:'movimento_proximo'};
      return {score:20,relation:'data_diferente'};
    };
    for(const i of I){
      const candidates=D.filter(d=>!usedD.has(d.id)&&Math.abs(d.value-i.value)<=tolerance)
        .map(d=>({d,sim:partySimilarity(i.payee,d.name),ds:dateScore(i,d)}))
        .filter(x=>x.sim>=0.25 || x.ds.score<=2)
        .sort((a,b)=>a.ds.score-b.ds.score||b.sim-a.sim);
      if(candidates.length){
        const best=candidates[0].d; usedI.add(i.id); usedD.add(best.id);
        results.push({...i,note:best.note||'',dealerGroupId:best.id,dealerValue:best.value,dealerPrincipal:best.value,dealerAdjusted:best.value,totalReceivedItau:i.value,adjustmentValue:0,dealerDate:best.cashDate||best.date,dealerMovementDate:best.movementDate||'',dateRelation:dateScore(i,best).relation,interest:0,discount:0,receipt:best.value,difference:round2(i.value-best.value),finalDifference:round2(i.value-best.value),status:'ok',reason:'Conciliado',matchedTitles:[best]});
      }
    }
    // Passo 2: grupo exato por favorecido/entidade. É importante para pagamentos bancários
    // agrupados, mesmo quando a Razão Social do Itaú é diferente do nome do Dealer.
    // Ex.: R$ 1.034.212,00 no Itaú formado por 12 títulos da LM no Dealer.
    for(const i of I){
      if(usedI.has(i.id)) continue;
      const pool=D.filter(d=>!usedD.has(d.id));
      const exact=findExactPartyGroup(i.value,pool,tolerance);
      if(exact && exact.items.length>1){
        exact.items.forEach(d=>usedD.add(d.id)); usedI.add(i.id);
        const principal=round2(exact.items.reduce((s,d)=>s+d.value,0));
        const titles=exact.items.map(d=>d.note||d.parcel||d.name).filter(Boolean);
        const dateInfo=exact.items.map(d=>dateScore(i,d)).sort((a,b)=>a.score-b.score)[0]||{relation:'data_diferente'};
        results.push({...i,note:`${titles[0]||exact.key} + ${Math.max(0,titles.length-1)} títulos`,dealerGroupId:exact.items.map(d=>d.id).join(','),dealerValue:principal,dealerPrincipal:principal,dealerAdjusted:principal,totalReceivedItau:i.value,adjustmentValue:0,dealerDate:exact.items.map(d=>d.cashDate||d.date).filter(Boolean).sort()[0]||'',dealerMovementDate:exact.items.map(d=>d.movementDate||d.date).filter(Boolean).sort()[0]||'',dateRelation:dateInfo.relation,interest:0,discount:0,receipt:principal,difference:0,finalDifference:0,status:'grouped',reason:`Conciliado por agrupamento exato (${exact.items.length} títulos de ${exact.key})`,matchedTitles:exact.items});
      }
    }

    for(const i of I){
      if(usedI.has(i.id)) continue;
      const pool=D.filter(d=>!usedD.has(d.id));
      // Primeiro tenta por data e nome, mas permite agrupamento por valor quando a empresa é claramente relacionada.
      const related=pool.filter(d=>partySimilarity(i.payee,d.name)>=0.25 || normalizePartyKey(i.payee)===normalizePartyKey(d.name));
      const candidates=related.length?related:pool;
      const combo=paymentCombinations(candidates,i.value,maxGroup,tolerance);
      if(combo){
        const sim=Math.max(...combo.items.map(d=>partySimilarity(i.payee,d.name)),0);
        const ds=combo.items.map(d=>dateScore(i,d)).sort((a,b)=>a.score-b.score)[0]||{score:20,relation:'data_diferente'};
        // Agrupamento sem relação nominal só é aceito quando o fechamento é exato e existe mais de um título.
        if(sim>=0.25 || combo.items.length>1){
          combo.items.forEach(d=>usedD.add(d.id)); usedI.add(i.id);
          const principal=round2(combo.items.reduce((s,d)=>s+d.value,0));
          const titles=combo.items.map(d=>d.note||d.parcel||d.name).filter(Boolean);
          results.push({...i,note:titles.length===1?titles[0]:`${titles[0]||'Títulos'} + ${Math.max(0,titles.length-1)} títulos`,dealerGroupId:combo.items.map(d=>d.id).join(','),dealerValue:principal,dealerPrincipal:principal,dealerAdjusted:principal,totalReceivedItau:i.value,adjustmentValue:0,dealerDate:combo.items.map(d=>d.cashDate||d.date).filter(Boolean).sort()[0]||'',dealerMovementDate:combo.items.map(d=>d.movementDate||d.date).filter(Boolean).sort()[0]||'',dateRelation:ds.relation,interest:0,discount:0,receipt:principal,difference:0,finalDifference:0,status:'grouped',reason:`Conciliado por agrupamento (${combo.items.length} títulos)`,matchedTitles:combo.items});
        }
      }
    }
    // Prováveis divergências: mesma empresa e datas compatíveis, sem forçar por valor.
    for(const i of I){
      if(usedI.has(i.id)) continue;
      const cand=D.filter(d=>!usedD.has(d.id)).map(d=>({d,sim:partySimilarity(i.payee,d.name),ds:dateScore(i,d),diff:Math.abs(i.value-d.value)}))
        .filter(x=>x.sim>=0.5 && x.ds.score<=4).sort((a,b)=>a.diff-b.diff||a.ds.score-b.ds.score)[0];
      if(cand){usedI.add(i.id);usedD.add(cand.d.id);results.push({...i,note:cand.d.note||'',dealerGroupId:cand.d.id,dealerValue:cand.d.value,dealerPrincipal:cand.d.value,dealerAdjusted:cand.d.value,totalReceivedItau:i.value,adjustmentValue:0,dealerDate:cand.d.cashDate||cand.d.date,dealerMovementDate:cand.d.movementDate||'',dateRelation:cand.ds.relation,interest:0,discount:0,receipt:cand.d.value,difference:round2(i.value-cand.d.value),finalDifference:round2(i.value-cand.d.value),status:'difference',reason:'Possível correspondência com diferença de valor',matchedTitles:[cand.d]});}
    }
    const itauOnly=I.filter(i=>!usedI.has(i.id)).map(i=>({...i,note:'',dealerValue:null,dealerPrincipal:null,dealerAdjusted:null,totalReceivedItau:i.value,difference:i.value,finalDifference:i.value,interest:0,discount:0,status:'missing',reason:'Não localizado no Dealer',matchedTitles:[]}));
    const dealerOnly=D.filter(d=>!usedD.has(d.id)).map(d=>({id:d.id,payee:d.name,note:d.note||d.parcel||'',date:d.cashDate||d.date,dealerMovementDate:d.movementDate||'',dealerValue:d.value,dealerPrincipal:d.value,dealerAdjusted:d.value,totalReceivedItau:null,difference:-d.value,finalDifference:-d.value,interest:0,discount:0,status:'dealerOnly',reason:'Baixado no Dealer, não localizado no Itaú',matchedTitles:[d]}));
    results.push(...itauOnly);
    return {results,dealerOnly,itauOnly,totals:{itauCount:I.length,dealerCount:D.length,itauValue:round2(I.reduce((s,x)=>s+x.value,0)),dealerValue:round2(D.reduce((s,x)=>s+x.value,0))}};
  }

  return {
    MONEY_TOLERANCE,
    normalizeText,
    parseMoneyBR,
    formatDateBR,
    parseBankTitle,
    extractItauRows,
    parseDealerText,
    groupDealerEntries,
    reconcile,
    round2,
    dayDiff,
    extractItauPaymentRows,
    extractDealerExcelRows,
    reconcilePayments
  };
});
