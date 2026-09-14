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
    // Termos societários/genéricos não podem, sozinhos, transformar dois nomes distintos
    // em uma entidade relacionada. Isso evita falso positivo como "EMPRESA A" × "EMPRESA B".
    const stop=new Set(['empresa','ltda','limitada','eireli','sociedade','companhia','grupo','holding','participacoes','participacao','comercio','comercial','servico','servicos','industria','industrial','consultoria','sistema','sistemas','representacao','representacoes','treinamento','me','epp','sa']);
    const toks=s=>normalizePartyKey(s).split(/\s+/).filter(x=>x.length>=3&&!stop.has(x));
    const A=new Set(toks(a));
    const B=new Set(toks(b));
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

  function reconcilePayments(itauRows,dealerRows) {
    const bank=itauRows.map((x,n)=>({...x,id:x.id||`I${n+1}`,value:Math.abs(round2(x.value)),_order:n})).filter(x=>Number.isFinite(x.value)&&x.value>0);
    const titles=dealerRows.map((x,n)=>({...x,id:x.id||`D${n+1}`,value:Math.abs(round2(x.value)),_order:n})).filter(x=>Number.isFinite(x.value)&&x.value>0);
    const cents=v=>Math.round(v*100);
    const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v);
    const clean=s=>normalizeText(s).replace(/\b(ltda|eireli|me|sa|s a|epp|cia|de|da|do|dos|das)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
    // Similaridade nominal: combinação de palavras e segmentos comuns, sem equiparar
    // entidades por valor isolado ou pelo fragmento genérico "despachante".
    function longest(a,b){let len=0,at=0,bt=0,prev=new Array(b.length+1).fill(0);
      for(let i=0;i<a.length;i++){const curr=new Array(b.length+1).fill(0);for(let j=0;j<b.length;j++)if(a[i]===b[j]){curr[j+1]=prev[j]+1;if(curr[j+1]>len){len=curr[j+1];at=i-len+1;bt=j-len+1;}}prev=curr;}return {len,at,bt};}
    function matching(a,b){const m=longest(a,b);if(!m.len)return 0;return m.len+matching(a.slice(0,m.at),b.slice(0,m.bt))+matching(a.slice(m.at+m.len),b.slice(m.bt+m.len));}
    function sim(a,b){const A=clean(a),B=clean(b);if(!A||!B)return 0;
      const as=new Set(A.split(' ')),bs=new Set(B.split(' '));let common=0;for(const x of as)if(bs.has(x))common++;
      return Math.max(common/Math.max(1,new Set([...as,...bs]).size),2*matching(A,B)/(A.length+B.length));}
    function samePrincipalName(a,b){
      const meaningful=s=>clean(s).split(' ').find(t=>/[a-z]/.test(t)&&t.length>=3)||'';
      const A=meaningful(a),B=meaningful(b);
      if(!A||!B)return false;
      return A===B || (Math.min(A.length,B.length)>=6 && 2*matching(A,B)/(A.length+B.length)>=.8);
    }
    const used=new Set(),chosen=new Map();
    function assign(i,ds,status,reason){ds.forEach(d=>used.add(d.id));chosen.set(i.id,{ds,status,reason});}
    const groups=new Map();for(const d of titles){if(!groups.has(d.name))groups.set(d.name,[]);groups.get(d.name).push(d);}
    // Fase 1: soma integral de um único credor, antes dos valores individuais.
    for(const i of bank){
      const candidates=[];
      for(const [name,ds] of groups){if(ds.length<2||ds.some(d=>used.has(d.id)))continue;
        if(ds.reduce((v,d)=>v+cents(d.value),0)===cents(i.value))candidates.push({name,ds,score:sim(i.payee||i.name,name)});
      }
      candidates.sort((a,b)=>b.score-a.score||a.ds.length-b.ds.length);
      if(!candidates.length)continue;
      const best=candidates[0],repeat=new Set(best.ds.map(d=>cents(d.value))).size<best.ds.length;
      const ambiguous=candidates.length>1 || repeat || best.score<.50 || !samePrincipalName(i.payee||i.name,best.name);
      const stateMismatch=/\bsefaz[\s/-]*[a-z]{2}\b/i.test(i.payee||i.name||'') && /\b(secretaria|fazenda)\b/i.test(best.name);
      assign(i,best.ds,ambiguous?'review':'grouped',candidates.length>1?'Mais de um credor soma exatamente este pagamento; verificar o vínculo':stateMismatch?'Soma exata, mas estado/beneficiário divergente':repeat?'Soma exata; valores repetidos tornam a vinculação individual ambígua':best.score<.50||!samePrincipalName(i.payee||i.name,best.name)?'Soma exata, mas nome do favorecido diferente':'Soma exata de títulos do mesmo favorecido');
    }
    // Fase 2: valor unitário exato. Repetições e identidade divergente exigem revisão.
    const bc=new Map(),dc=new Map();for(const i of bank)bc.set(cents(i.value),(bc.get(cents(i.value))||0)+1);
    for(const d of titles)dc.set(cents(d.value),(dc.get(cents(d.value))||0)+1);
    for(const i of bank){if(chosen.has(i.id))continue;
      const candidates=titles.filter(d=>!used.has(d.id)&&cents(d.value)===cents(i.value))
        .map(d=>({d,score:sim(i.payee||i.name,d.name)})).sort((a,b)=>b.score-a.score||a.d._order-b.d._order);
      if(!candidates.length)continue;
      const best=candidates[0],bankRepeat=bc.get(cents(i.value))>1,dealerRepeat=dc.get(cents(i.value))>1,repeat=bankRepeat||dealerRepeat;
      const ambiguous=candidates.length>1&&Math.abs(candidates[0].score-candidates[1].score)<.001;
      const repeatedReason=bankRepeat&&!dealerRepeat?'Há débitos iguais no Itaú e apenas um título correspondente; conferir este vínculo':'Valores repetidos; títulos iguais podem ser intercambiáveis sem outro identificador';
      assign(i,[best.d],repeat||ambiguous||best.score<.50||!samePrincipalName(i.payee||i.name,best.d.name)?'review':'ok',repeat||ambiguous?repeatedReason:best.score<.50||!samePrincipalName(i.payee||i.name,best.d.name)?'Valor exato, mas nome do favorecido diferente':'Favorecido compatível e valor exato');
    }
    // Um subtotal apenas semelhante não baixa títulos nem vira confirmação.
    const results=bank.map(i=>{
      const picked=chosen.get(i.id),ds=picked?.ds||[],v=round2(ds.reduce((s,d)=>s+d.value,0));
      const bankName=i.payee||i.name||'';
      const sameName=titles.filter(d=>!/^banco\b/i.test(bankName)&&samePrincipalName(bankName,d.name));
      const subtotal=round2(sameName.reduce((s,d)=>s+d.value,0));
      const earlier=bank.slice(0,i._order).filter(other=>cents(other.value)===cents(i.value)&&samePrincipalName(other.payee||other.name,bankName)&&chosen.has(other.id));
      const bankCounterparty=/^banco\s+(.+)/i.exec(bankName);
      const bankHasNoOwnCreditor=bankCounterparty && !titles.some(d=>/^banco\b/i.test(d.name)&&samePrincipalName(bankName,d.name));
      const brand=bankCounterparty?.[1]?.split(/\s+/)[0].replace(/[^\p{L}\p{N}]/gu,'');
      const relatedMerchant=bankHasNoOwnCreditor && brand && titles.some(d=>normalizeText(d.name).includes(normalizeText(brand)));
      let reason=picked?.reason;
      if(!reason && earlier.length)reason='Segundo débito desse valor, sem segundo título correspondente';
      if(!reason && relatedMerchant)reason=`Não há credor “${bankName}” no Dealer; não atribuí a ele títulos da “${brand}”`;
      if(!reason && sameName.length)reason=`Há títulos do mesmo credor somando ${money(subtotal)}, mas não fecham este pagamento; faltam ${money(round2(i.value-subtotal))} para essa comparação`;
      if(!reason)reason='Sem correspondência segura no Dealer';
      return {...i,payee:i.payee||i.name,sourceBankRows:[i],matchedTitles:ds,status:picked?.status||'missing',reason,method:reason,
        value:i.value,dealerValue:ds.length?v:null,dealerPrincipal:ds.length?v:null,dealerAdjusted:ds.length?v:null,
        difference:round2(i.value-v),note:ds.map(d=>d.parcel||d.note||d.id).join(' + '),groupShape:`1×${ds.length}`,_order:i._order};
    });
    const dealerOnly=titles.filter(d=>!used.has(d.id)).map(d=>({sourceBankRows:[],matchedTitles:[d],status:'dealerOnly',reason:'Somente Dealer',method:'Somente Dealer',value:null,dealerValue:d.value,difference:-d.value,groupShape:'0×1'}));
    return {results,dealerOnly,itauOnly:results.filter(r=>r.status==='missing'),totals:{itauCount:bank.length,dealerCount:titles.length,itauValue:round2(bank.reduce((s,i)=>s+i.value,0)),dealerValue:round2(titles.reduce((s,d)=>s+d.value,0))}};
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
