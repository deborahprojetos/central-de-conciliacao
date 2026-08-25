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
        value: Math.round(value * 100) / 100
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
        dealerAdjusted: group.total,
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
      value: null, dealerValue: g.receipt, dealerAdjusted: g.total, difference: -g.receipt, finalDifference: -g.total,
      receipt: g.receipt, interest: g.interest, discount: g.discount,
      status: 'dealerOnly', reason: 'Movimento existe somente no Dealer', movement: g.movement, launch: g.launch
    }));

    return { results, dealerGroups, dealerOnly };
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
    dayDiff
  };
});
