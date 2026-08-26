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
    const sameNote = groups.filter(g => !g.used && g.note === bankRow.note);
    if (!sameNote.length) return { group: null, dateFallback: false, dateRelation: 'missing' };

    const ranked = sameNote.map(g => ({
      g,
      amountDiff: Math.abs(round2(bankRow.value - g.total)),
      dateScore: dealerDateScore(bankRow, g)
    })).sort((a, b) => {
      const aExact = a.amountDiff < MONEY_TOLERANCE ? 0 : 1;
      const bExact = b.amountDiff < MONEY_TOLERANCE ? 0 : 1;
      return aExact - bExact || a.amountDiff - b.amountDiff || a.dateScore - b.dateScore;
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
      const rawValue=parseMoneyBR(row[h.value]);
      // Modo pagamentos: não transformar créditos/recebimentos em pagamentos por usar Math.abs.
      if(!name || !date || !Number.isFinite(rawValue) || rawValue>=0) continue;
      const value=Math.abs(rawValue);
      const id='IP'+(++seq);
      out.push({id,sourceRow:r+1,payee:name,date,value:round2(value),signedValue:rawValue,note:'',yourNumber:'',installment:''});
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

  // Relações conhecidas são CANDIDATAS, nunca regras de conciliação automática.
  // Elas apenas autorizam o motor a testar a combinação. A confirmação continua
  // dependendo de fechamento matemático exato entre Itaú e Dealer.
  const KNOWN_PARTY_RELATIONS=[
    {a:'volkswagen',b:'lm transport',label:'Volkswagen ↔ LM'}
  ];

  function knownPartyRelation(a,b){
    const A=normalizePartyKey(a), B=normalizePartyKey(b);
    return KNOWN_PARTY_RELATIONS.find(r=>(A===r.a&&B===r.b)||(A===r.b&&B===r.a))||null;
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
    const maxSubset=options.maxSubset??12;
    const I=itauRows.map((x,idx)=>({...x,_order:idx,value:Math.abs(round2(x.value))})).filter(x=>Number.isFinite(x.value)&&x.value>0);
    const D=dealerRows.map((x,idx)=>({...x,_order:idx,value:Math.abs(round2(x.value))})).filter(x=>Number.isFinite(x.value)&&x.value>0);
    const usedI=new Set(), usedD=new Set(), results=[];
    const tolC=Math.round(tolerance*100);
    const toC=v=>Math.round(round2(v)*100);

    const dateDistance=(i,d)=>{
      const vals=[
        dayDiff(i.date,d.movementDate||d.date),
        dayDiff(i.date,d.cashDate||d.date)
      ].filter(Number.isFinite).map(Math.abs);
      return vals.length?Math.min(...vals):Infinity;
    };
    const dateScore=(i,d)=>{
      const md=dayDiff(i.date,d.movementDate||d.date); const cd=dayDiff(i.date,d.cashDate||d.date);
      if(Number.isFinite(md)&&md===0) return {score:0,relation:'movimento_mesmo_dia'};
      if(Number.isFinite(cd)&&Math.abs(cd)===1) return {score:1,relation:'caixa_dia_seguinte'};
      if(Number.isFinite(cd)&&cd===0) return {score:2,relation:'caixa_mesmo_dia'};
      if(Number.isFinite(md)&&Math.abs(md)<=3) return {score:4+Math.abs(md),relation:'movimento_proximo'};
      if(Number.isFinite(cd)&&Math.abs(cd)<=3) return {score:8+Math.abs(cd),relation:'caixa_proximo'};
      return {score:20,relation:'data_diferente'};
    };
    const partyKey=x=>normalizePartyKey(x.payee||x.name||'');
    const bankName=i=>i.payee||i.name||'';
    const dealerName=d=>d.name||d.payee||'';
    const namesRelated=(i,d)=>partySimilarity(bankName(i),dealerName(d))>=0.25 || partyKey(i)===partyKey(d);
    const sameIdentifier=(i,d)=>{
      const a=normalizeId(i.note||i.yourNumber||'');
      const b=normalizeId(d.note||d.parcel||'');
      return !!(a&&b&&a===b);
    };
    const sum=items=>round2(items.reduce((s,x)=>s+x.value,0));
    const dateCompatible=(bankItems,dealerItems,maxDays=3)=>{
      let best=Infinity;
      for(const i of bankItems) for(const d of dealerItems) best=Math.min(best,dateDistance(i,d));
      return !Number.isFinite(best) || best<=maxDays;
    };
    const homogeneous=(items,side)=>{
      if(!items.length) return false;
      const base=side==='I'?bankName(items[0]):dealerName(items[0]);
      return items.every(x=>partySimilarity(base,side==='I'?bankName(x):dealerName(x))>=0.5 || normalizePartyKey(base)===normalizePartyKey(side==='I'?bankName(x):dealerName(x)));
    };
    const bucketByParty=(items,side)=>{
      const buckets=[];
      for(const x of items){
        const name=side==='I'?bankName(x):dealerName(x);
        let b=buckets.find(g=>partySimilarity(g.name,name)>=0.5 || normalizePartyKey(g.name)===normalizePartyKey(name));
        if(!b){b={name,items:[]};buckets.push(b);}
        b.items.push(x);
      }
      return buckets;
    };
    const subsetExact=(items,target,preferDate,side)=>{
      if(!items.length) return null;
      if(items.length<=maxGroup && Math.abs(sum(items)-target)<tolerance) return items.slice();
      if(items.length>maxGroup) return null;
      const targetC=toC(target);
      const ordered=items.slice().sort((a,b)=>{
        const ad=preferDate?(side==='D'?dateDistance(preferDate,a):dateDistance(a,preferDate)):Infinity;
        const bd=preferDate?(side==='D'?dateDistance(preferDate,b):dateDistance(b,preferDate)):Infinity;
        return ad-bd || b.value-a.value;
      });
      const mid=Math.floor(ordered.length/2), left=ordered.slice(0,mid), right=ordered.slice(mid);
      const penalty=x=>{
        const d=preferDate?(side==='D'?dateDistance(preferDate,x):dateDistance(x,preferDate)):0;
        return Number.isFinite(d)?d:4;
      };
      const enumerate=arr=>{
        const out=[]; const n=arr.length;
        for(let mask=0;mask<(1<<n);mask++){
          let sc=0, count=0, datePenalty=0; const chosen=[];
          for(let j=0;j<n;j++) if(mask&(1<<j)){sc+=toC(arr[j].value);count++;datePenalty+=penalty(arr[j]);chosen.push(arr[j]);}
          if(sc<=targetC+tolC) out.push({sum:sc,count,datePenalty,items:chosen});
        }
        return out;
      };
      const L=enumerate(left), R=enumerate(right);
      const rMap=new Map();
      for(const r of R){
        const prev=rMap.get(r.sum);
        if(!prev || r.count<prev.count || (r.count===prev.count && r.datePenalty<prev.datePenalty)) rMap.set(r.sum,r);
      }
      let best=null;
      for(const l of L){
        for(let delta=-tolC;delta<=tolC;delta++){
          const r=rMap.get(targetC-l.sum+delta); if(!r) continue;
          const chosen=l.items.concat(r.items); if(!chosen.length) continue;
          const diff=Math.abs(l.sum+r.sum-targetC), score=diff*100000 + chosen.length*100 + l.datePenalty+r.datePenalty;
          if(!best || score<best.score) best={items:chosen,score};
        }
      }
      return best?best.items:null;
    };
    const describeTitles=items=>{
      const vals=items.map(d=>d.note||d.parcel||d.name).filter(Boolean);
      if(!vals.length) return `${items.length} título${items.length===1?'':'s'}`;
      return items.length===1?String(vals[0]):`${vals[0]} + ${items.length-1} título${items.length-1===1?'':'s'}`;
    };
    const makeResult=(bankItems,dealerItems,status,reason,method)=>{
      const iv=sum(bankItems), dv=sum(dealerItems);
      const firstI=bankItems[0]||{};
      const firstD=dealerItems[0]||{};
      const bestDate=bankItems.length&&dealerItems.length
        ? bankItems.flatMap(i=>dealerItems.map(d=>({i,d,dist:dateDistance(i,d)}))).sort((a,b)=>a.dist-b.dist)[0]
        : null;
      return {
        ...firstI,
        id: bankItems.map(x=>x.id).join('+') || `D-${dealerItems.map(x=>x.id).join('+')}`,
        payee: [...new Set(bankItems.map(bankName).filter(Boolean))].join(' + ') || '—',
        note: describeTitles(dealerItems),
        value: bankItems.length?iv:null,
        dealerGroupId:dealerItems.map(d=>d.id).join(','),
        dealerValue:dealerItems.length?dv:null,
        dealerPrincipal:dealerItems.length?dv:null,
        dealerAdjusted:dealerItems.length?dv:null,
        totalReceivedItau:bankItems.length?iv:null,
        adjustmentValue:0,
        dealerDate:dealerItems.map(d=>d.cashDate||d.date).filter(Boolean).sort()[0]||'',
        dealerMovementDate:dealerItems.map(d=>d.movementDate||d.date).filter(Boolean).sort()[0]||'',
        dateRelation:bestDate?dateScore(bestDate.i,bestDate.d).relation:'',
        interest:0,discount:0,receipt:dealerItems.length?dv:null,
        difference:round2((bankItems.length?iv:0)-(dealerItems.length?dv:0)),
        finalDifference:round2((bankItems.length?iv:0)-(dealerItems.length?dv:0)),
        status,reason,method,
        groupShape:`${bankItems.length}×${dealerItems.length}`,
        sourceBankRows:bankItems,
        matchedTitles:dealerItems,
        _order:bankItems.length?Math.min(...bankItems.map(x=>x._order)):Number.MAX_SAFE_INTEGER
      };
    };
    const consume=(bankItems,dealerItems,status,reason,method)=>{
      bankItems.forEach(i=>usedI.add(i.id)); dealerItems.forEach(d=>usedD.add(d.id));
      results.push(makeResult(bankItems,dealerItems,status,reason,method));
    };

    // 0) Duplicidades reais N×N: mesmo valor repetido, entidades relacionadas e janela de datas compatível.
    // Isto evita transformar IPOG 2×2 ou Ouro Verde 2×2 em dois pares 1×1 independentes.
    const iValueBuckets=new Map();
    for(const i of I){const k=toC(i.value);if(!iValueBuckets.has(k))iValueBuckets.set(k,[]);iValueBuckets.get(k).push(i);}
    const dValueBuckets=new Map();
    for(const d of D){const k=toC(d.value);if(!dValueBuckets.has(k))dValueBuckets.set(k,[]);dValueBuckets.get(k).push(d);}
    for(const [k,ibAll] of iValueBuckets){
      const dbAll=dValueBuckets.get(k)||[];
      if(ibAll.length<2||dbAll.length<2) continue;
      const iGroups=bucketByParty(ibAll.filter(i=>!usedI.has(i.id)),'I');
      const dGroups=bucketByParty(dbAll.filter(d=>!usedD.has(d.id)),'D');
      for(const ig of iGroups){
        if(ig.items.length<2) continue;
        const candidates=dGroups.filter(dg=>dg.items.length===ig.items.length && (partySimilarity(ig.name,dg.name)>=0.25 || normalizePartyKey(ig.name)===normalizePartyKey(dg.name)) && dateCompatible(ig.items,dg.items,3));
        if(!candidates.length) continue;
        const dg=candidates.sort((a,b)=>partySimilarity(ig.name,b.name)-partySimilarity(ig.name,a.name))[0];
        consume(ig.items,dg.items,'grouped',`Conciliado por agrupamento ${ig.items.length}×${dg.items.length}`,`${ig.items.length}×${dg.items.length} · duplicidade`);
      }
    }

    // 1) Relação 1×1 por valor exato. Nome, documento e data servem para ordenar candidatos, não para substituir o fechamento.
    for(const i of I){
      if(usedI.has(i.id)) continue;
      const exact=D.filter(d=>!usedD.has(d.id)&&Math.abs(d.value-i.value)<=tolerance)
        .map(d=>({d,sim:partySimilarity(bankName(i),dealerName(d)),id:sameIdentifier(i,d)?1:0,ds:dateScore(i,d)}));
      const strong=exact.filter(x=>x.id || x.sim>=0.25).sort((a,b)=>b.id-a.id || a.ds.score-b.ds.score || b.sim-a.sim);
      if(strong.length){ consume([i],[strong[0].d],'ok','Conciliado','1×1 · mesma entidade/valor'); continue; }
    }

    // 2) Relação 1×N. Primeiro tenta grupos por entidade; sem relação nominal, só aceita grupo homogêneo + data compatível + soma exata.
    for(const i of I){
      if(usedI.has(i.id)) continue;
      const pool=D.filter(d=>!usedD.has(d.id));
      const groups=bucketByParty(pool,'D').map(g=>({g,sim:partySimilarity(bankName(i),g.name),dateOk:dateCompatible([i],g.items,3)}))
        .sort((a,b)=>(b.sim>=0.25)-(a.sim>=0.25) || b.sim-a.sim || Number(b.dateOk)-Number(a.dateOk));
      const hits=[];
      for(const x of groups){
        if(!x.g.items.length || x.g.items.length>maxGroup) continue;
        if(x.sim<0.25 && !x.dateOk) continue;
        const subset=subsetExact(x.g.items,i.value,i,'D');
        if(subset && subset.length>1 && homogeneous(subset,'D') && dateCompatible([i],subset,3)) hits.push({items:subset,sim:x.sim});
      }
      const named=hits.filter(x=>x.sim>=0.25).sort((a,b)=>b.sim-a.sim || a.items.length-b.items.length);
      const hit=named.length?named[0].items:null;
      if(hit) consume([i],hit,'grouped',`Conciliado por agrupamento 1×${hit.length}`,`1×${hit.length} · mesma entidade`);
    }

    // 3) Relação N×1, simétrica ao passo anterior.
    for(const d of D){
      if(usedD.has(d.id)) continue;
      const pool=I.filter(i=>!usedI.has(i.id));
      const groups=bucketByParty(pool,'I').map(g=>({g,sim:partySimilarity(g.name,dealerName(d)),dateOk:dateCompatible(g.items,[d],3)}))
        .sort((a,b)=>(b.sim>=0.25)-(a.sim>=0.25) || b.sim-a.sim || Number(b.dateOk)-Number(a.dateOk));
      const hits=[];
      for(const x of groups){
        if(!x.g.items.length || x.g.items.length>maxGroup) continue;
        if(x.sim<0.25 && !x.dateOk) continue;
        const subset=subsetExact(x.g.items,d.value,d,'I');
        if(subset && subset.length>1 && homogeneous(subset,'I') && dateCompatible(subset,[d],3)) hits.push({items:subset,sim:x.sim});
      }
      const named=hits.filter(x=>x.sim>=0.25).sort((a,b)=>b.sim-a.sim || a.items.length-b.items.length);
      const hit=named.length?named[0].items:null;
      if(hit) consume(hit,[d],'grouped',`Conciliado por agrupamento ${hit.length}×1`,`${hit.length}×1 · mesma entidade`);
    }

    // 4) Relação N×N. Não há regra fixa de fornecedor: os grupos são reconstruídos a cada execução.
    // O fechamento só é aceito se ambos os lados forem internamente coerentes e as somas forem iguais.
    let iGroups=bucketByParty(I.filter(i=>!usedI.has(i.id)),'I').filter(g=>g.items.length>1&&g.items.length<=maxGroup);
    let dGroups=bucketByParty(D.filter(d=>!usedD.has(d.id)),'D').filter(g=>g.items.length>1&&g.items.length<=maxGroup);
    for(const ig of iGroups){
      if(ig.items.some(i=>usedI.has(i.id))) continue;
      const iv=sum(ig.items);
      const candidates=dGroups.filter(dg=>!dg.items.some(d=>usedD.has(d.id)) && Math.abs(sum(dg.items)-iv)<tolerance && dateCompatible(ig.items,dg.items,3))
        .map(dg=>({dg,sim:partySimilarity(ig.name,dg.name)}))
        .sort((a,b)=>b.sim-a.sim || a.dg.items.length-b.dg.items.length);
      if(candidates.length){
        const named=candidates.filter(x=>x.sim>=0.25);
        const chosen=named.length?named[0]:null;
        if(chosen){
          const dg=chosen.dg;
          consume(ig.items,dg.items,'grouped',`Conciliado por agrupamento ${ig.items.length}×${dg.items.length}`,`${ig.items.length}×${dg.items.length} · mesma entidade`);
        }
      }
    }

    // 5) Relações candidatas previamente conhecidas.
    // Ex.: LM pode representar pagamentos Volkswagen. A relação NÃO basta para conciliar:
    // o conjunto só é consumido quando a soma fecha exatamente.
    for(const i of I){
      if(usedI.has(i.id)) continue;
      const exact=D.filter(d=>!usedD.has(d.id) && Math.abs(d.value-i.value)<=tolerance)
        .map(d=>({d,rel:knownPartyRelation(bankName(i),dealerName(d)),ds:dateScore(i,d)}))
        .filter(x=>x.rel)
        .sort((a,b)=>a.ds.score-b.ds.score);
      if(exact.length){
        const x=exact[0];
        consume([i],[x.d],'ok','Conciliado por relação candidata',`1×1 · relação candidata ${x.rel.label}`);
      }
    }

    for(const i of I){
      if(usedI.has(i.id)) continue;
      const pool=D.filter(d=>!usedD.has(d.id));
      const groups=bucketByParty(pool,'D');
      const hits=[];
      for(const g of groups){
        const rel=knownPartyRelation(bankName(i),g.name);
        if(!rel || !g.items.length || g.items.length>maxGroup) continue;
        const subset=subsetExact(g.items,i.value,i,'D');
        if(subset && subset.length>1 && homogeneous(subset,'D')) hits.push({items:subset,rel});
      }
      if(hits.length){
        hits.sort((a,b)=>a.items.length-b.items.length);
        const hit=hits[0];
        consume([i],hit.items,'grouped',`Conciliado por agrupamento 1×${hit.items.length}`,`1×${hit.items.length} · relação candidata ${hit.rel.label}`);
      }
    }

    for(const d of D){
      if(usedD.has(d.id)) continue;
      const pool=I.filter(i=>!usedI.has(i.id));
      const groups=bucketByParty(pool,'I');
      const hits=[];
      for(const g of groups){
        const rel=knownPartyRelation(g.name,dealerName(d));
        if(!rel || !g.items.length || g.items.length>maxGroup) continue;
        const subset=subsetExact(g.items,d.value,d,'I');
        if(subset && subset.length>1 && homogeneous(subset,'I')) hits.push({items:subset,rel});
      }
      if(hits.length){
        hits.sort((a,b)=>a.items.length-b.items.length);
        const hit=hits[0];
        consume(hit.items,[d],'grouped',`Conciliado por agrupamento ${hit.items.length}×1`,`${hit.items.length}×1 · relação candidata ${hit.rel.label}`);
      }
    }

    iGroups=bucketByParty(I.filter(i=>!usedI.has(i.id)),'I').filter(g=>g.items.length>1&&g.items.length<=maxGroup);
    dGroups=bucketByParty(D.filter(d=>!usedD.has(d.id)),'D').filter(g=>g.items.length>1&&g.items.length<=maxGroup);
    for(const ig of iGroups){
      if(ig.items.some(i=>usedI.has(i.id))) continue;
      const iv=sum(ig.items);
      const candidates=dGroups.filter(dg=>!dg.items.some(d=>usedD.has(d.id)) && Math.abs(sum(dg.items)-iv)<tolerance)
        .map(dg=>({dg,rel:knownPartyRelation(ig.name,dg.name)})).filter(x=>x.rel);
      if(candidates.length){
        const chosen=candidates.sort((a,b)=>a.dg.items.length-b.dg.items.length)[0];
        consume(ig.items,chosen.dg.items,'grouped',`Conciliado por agrupamento ${ig.items.length}×${chosen.dg.items.length}`,`${ig.items.length}×${chosen.dg.items.length} · relação candidata ${chosen.rel.label}`);
      }
    }

    // 6) Divergência: somente DEPOIS de consumir todos os fechamentos exatos.
    // A data ajuda a ordenar, mas nunca elimina uma contraparte claramente igual.
    // Geramos todos os pares plausíveis e consumimos primeiro os mais fortes/mais próximos,
    // evitando que a ordem das linhas escolha uma divergência pior.
    const divergencePairs=[];
    for(const i of I){
      if(usedI.has(i.id)) continue;
      for(const d of D){
        if(usedD.has(d.id)) continue;
        const sim=partySimilarity(bankName(i),dealerName(d));
        const id=sameIdentifier(i,d)?1:0;
        const sameKey=normalizePartyKey(bankName(i))===normalizePartyKey(dealerName(d))?1:0;
        if(!(id || sameKey || sim>=0.5)) continue;
        const ds=dateScore(i,d);
        divergencePairs.push({i,d,id,sameKey,sim,ds,diff:Math.abs(round2(i.value-d.value))});
      }
    }
    divergencePairs.sort((a,b)=>b.id-a.id || b.sameKey-a.sameKey || a.diff-b.diff || a.ds.score-b.ds.score || b.sim-a.sim || a.i._order-b.i._order || a.d._order-b.d._order);
    for(const p of divergencePairs){
      if(usedI.has(p.i.id)||usedD.has(p.d.id)) continue;
      consume([p.i],[p.d],'difference','Divergência','Mesma entidade/documento · valor diferente');
    }

    // 7) Último recurso: mesmo valor, nomes diferentes. Não é conciliação automática.
    // Só formamos automaticamente um par quando o valor restante identifica um candidato único
    // em cada lado. Duplicidades ambíguas não são pareadas ao acaso.
    const reviewI=new Map(), reviewD=new Map();
    for(const i of I.filter(x=>!usedI.has(x.id))){const k=toC(i.value);if(!reviewI.has(k))reviewI.set(k,[]);reviewI.get(k).push(i);}
    for(const d of D.filter(x=>!usedD.has(x.id))){const k=toC(d.value);if(!reviewD.has(k))reviewD.set(k,[]);reviewD.get(k).push(d);}
    for(const [k,ib] of reviewI){
      const db=reviewD.get(k)||[];
      if(ib.length===1 && db.length===1){
        consume(ib,db,'review','Analisar: mesmo valor com nomes diferentes','Mesmo valor · nomes diferentes · candidato único');
      } else if(ib.length===db.length && ib.length>1){
        // Há equivalência matemática do conjunto, mas não evidência suficiente para dizer qual linha é qual.
        consume(ib,db,'review',`Analisar: ${ib.length} lançamentos de mesmo valor com nomes diferentes`,`${ib.length}×${db.length} · mesmo valor repetido · associação individual ambígua`);
      }
    }

    const itauOnly=I.filter(i=>!usedI.has(i.id)).map(i=>makeResult([i],[],'missing','Não localizado no Dealer','Sem correspondência após todos os métodos'));
    const dealerOnly=D.filter(d=>!usedD.has(d.id)).map(d=>makeResult([],[d],'dealerOnly','Baixado no Dealer, não localizado no Itaú','Sem correspondência após todos os métodos'));
    results.push(...itauOnly);
    results.sort((a,b)=>(a._order??0)-(b._order??0));
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
