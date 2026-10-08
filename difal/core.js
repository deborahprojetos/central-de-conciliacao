(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DifalCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[º°ª]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function normalizeDocument(value) {
    if (value === null || value === undefined) return '';
    const text = String(value).trim();
    const parcel = text.match(/^\s*([0-9]+)\s*[\/-]\s*[0-9]+\s*$/);
    if (parcel) return parcel[1].replace(/^0+(?=\d)/, '');
    const digits = text.replace(/\D/g, '');
    return digits.replace(/^0+(?=\d)/, '');
  }

  function parseMoney(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100);
    if (value === null || value === undefined || value === '') return null;

    let text = String(value).trim();
    if (!text) return null;
    text = text.replace(/R\$/gi, '').replace(/\s/g, '');

    let negative = false;
    if (/^\(.*\)$/.test(text)) {
      negative = true;
      text = text.slice(1, -1);
    }

    text = text.replace(/[^0-9,.-]/g, '');
    if (!text || text === '-' || text === '.' || text === ',') return null;

    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    let normalized;

    if (lastComma > lastDot) {
      normalized = text.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
      const decimals = text.length - lastDot - 1;
      normalized = decimals === 2 ? text.replace(/,/g, '') : text.replace(/[.,]/g, '');
    } else {
      normalized = text.replace(/[.,]/g, '');
    }

    const number = Number(normalized);
    if (!Number.isFinite(number)) return null;
    return Math.round((negative ? -number : number) * 100);
  }

  function formatMoney(cents) {
    if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return '—';
    return (Number(cents) / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function normalizeDate(value) {
    if (!value && value !== 0) return '';

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const d = String(value.getDate()).padStart(2, '0');
      const m = String(value.getMonth() + 1).padStart(2, '0');
      return `${d}/${m}/${value.getFullYear()}`;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const unixMs = Math.round((value - 25569) * 86400 * 1000);
      const date = new Date(unixMs);
      if (!Number.isNaN(date.getTime())) {
        const d = String(date.getUTCDate()).padStart(2, '0');
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        return `${d}/${m}/${date.getUTCFullYear()}`;
      }
    }

    const text = String(value).trim();
    let match = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
    if (match) return `${match[1].padStart(2, '0')}/${match[2].padStart(2, '0')}/${match[3]}`;

    match = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (match) return `${match[3].padStart(2, '0')}/${match[2].padStart(2, '0')}/${match[1]}`;

    return '';
  }

  function dateSortKey(datePt) {
    const m = String(datePt).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : String(datePt);
  }

  function isDealerHeader(line) {
    const n = normalizeText(line);
    return (n.includes('data pagto') || n.includes('data pagamento')) &&
      (n.includes('parcela') || n.includes('n parcela')) &&
      (n.includes('valor pagto') || n.includes('valor pagamento'));
  }

  function parseDealerText(text, selectedDate) {
    const lines = String(text || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const rows = [];
    const rejected = [];
    let headerMap = null;
    let headerCount = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const tabParts = line.split('\t').map((p) => p.trim());

      if (tabParts.length >= 3) {
        const normalized = tabParts.map(normalizeText);
        const dateIdx = normalized.findIndex((h) => h.includes('data pagto') || h.includes('data pagamento'));
        const docIdx = normalized.findIndex((h) => h.includes('parcela') && (h.includes('n') || h.includes('numero')));
        const valueIdx = normalized.findIndex((h) => h.includes('valor pagto') || h.includes('valor pagamento'));
        if (dateIdx >= 0 && docIdx >= 0 && valueIdx >= 0) {
          headerMap = { dateIdx, docIdx, valueIdx };
          headerCount += 1;
          continue;
        }
      }

      if (isDealerHeader(line)) {
        headerCount += 1;
        continue;
      }

      let date = '';
      let document = '';
      let parcel = '';
      let valueCents = null;

      if (headerMap && tabParts.length > Math.max(headerMap.dateIdx, headerMap.docIdx, headerMap.valueIdx)) {
        date = normalizeDate(tabParts[headerMap.dateIdx]);
        const docText = tabParts[headerMap.docIdx];
        const docMatch = String(docText).match(/(\d+)\s*[\/-]\s*(\d+)/);
        document = normalizeDocument(docText);
        parcel = docMatch ? docMatch[2] : '';
        valueCents = parseMoney(tabParts[headerMap.valueIdx]);
      }

      if (!document || valueCents === null) {
        const dateMatch = line.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
        const docMatch = line.match(/\b(\d{1,18})\s*[\/-]\s*(\d{1,4})\b/);
        if (docMatch) {
          document = normalizeDocument(docMatch[1]);
          parcel = docMatch[2];
          date = date || (dateMatch ? normalizeDate(dateMatch[1]) : normalizeDate(selectedDate));
          const afterDoc = line.slice((docMatch.index || 0) + docMatch[0].length);
          const moneyMatch = afterDoc.match(/(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?-?\d+,\d{2}|(?:R\$\s*)?-?\d+\.\d{2}/);
          if (moneyMatch) valueCents = parseMoney(moneyMatch[0]);
        }
      }

      if (!date && selectedDate) date = normalizeDate(selectedDate);

      if (date && document && valueCents !== null) {
        rows.push({
          id: `dealer-${lineIndex + 1}`,
          sourceLine: lineIndex + 1,
          date,
          document,
          parcel,
          valueCents,
          raw: line,
        });
      } else {
        rejected.push({ line: lineIndex + 1, raw: line });
      }
    }

    return {
      rows,
      rejected,
      inputLineCount: lines.length,
      headerCount,
    };
  }

  function groupByDocument(rows) {
    const map = new Map();
    rows.forEach((row) => {
      if (!map.has(row.document)) map.set(row.document, []);
      map.get(row.document).push(row);
    });
    return map;
  }

  function reconcileDay(bankRows, dealerRows, selectedDate) {
    const date = normalizeDate(selectedDate);
    const bank = bankRows.filter((r) => normalizeDate(r.date) === date);
    const dealer = dealerRows.filter((r) => normalizeDate(r.date) === date);

    const bankByDoc = groupByDocument(bank);
    const dealerByDoc = groupByDocument(dealer);
    const documents = new Set([...bankByDoc.keys(), ...dealerByDoc.keys()]);
    const results = [];
    const extras = [];

    for (const document of documents) {
      const bGroup = (bankByDoc.get(document) || []).map((r) => ({ ...r, _used: false }));
      const dGroup = (dealerByDoc.get(document) || []).map((r) => ({ ...r, _used: false }));

      // 1) Correspondências exatas primeiro. Uma linha do Dealer só pode ser consumida uma vez.
      for (const b of bGroup) {
        const exact = dGroup.find((d) => !d._used && d.valueCents === b.valueCents);
        if (!exact) continue;
        b._used = true;
        exact._used = true;
        results.push({
          bankId: b.id,
          date,
          document,
          bankValueCents: b.valueCents,
          dealerValueCents: exact.valueCents,
          differenceCents: 0,
          status: 'OK',
          bankSourceRow: b.sourceRow,
          dealerSourceLine: exact.sourceLine,
        });
      }

      // 2) Mesmo documento, valores diferentes: pareia pelo menor desvio, sempre 1:1.
      while (true) {
        const remainingB = bGroup.filter((b) => !b._used);
        const remainingD = dGroup.filter((d) => !d._used);
        if (!remainingB.length || !remainingD.length) break;

        let best = null;
        for (const b of remainingB) {
          for (const d of remainingD) {
            const abs = Math.abs(b.valueCents - d.valueCents);
            const bRow = Number(b.sourceRow || 0);
            if (!best || abs < best.abs || (abs === best.abs && bRow < Number(best.b.sourceRow || 0))) {
              best = { b, d, abs };
            }
          }
        }

        best.b._used = true;
        best.d._used = true;
        results.push({
          bankId: best.b.id,
          date,
          document,
          bankValueCents: best.b.valueCents,
          dealerValueCents: best.d.valueCents,
          differenceCents: best.b.valueCents - best.d.valueCents,
          status: 'DIVERGENCIA',
          bankSourceRow: best.b.sourceRow,
          dealerSourceLine: best.d.sourceLine,
        });
      }

      // 3) Sobrou no Banco Util: precisa pesquisar/baixar no Dealer.
      for (const b of bGroup.filter((b) => !b._used)) {
        b._used = true;
        results.push({
          bankId: b.id,
          date,
          document,
          bankValueCents: b.valueCents,
          dealerValueCents: null,
          differenceCents: null,
          status: 'DEALER',
          bankSourceRow: b.sourceRow,
          dealerSourceLine: null,
        });
      }

      // 4) Sobrou no Dealer: alerta adicional.
      for (const d of dGroup.filter((d) => !d._used)) {
        d._used = true;
        extras.push({
          date,
          document,
          dealerValueCents: d.valueCents,
          dealerSourceLine: d.sourceLine,
          status: 'SEM_BANCO_UTIL',
        });
      }
    }

    results.sort((a, b) => {
      const rowA = Number(a.bankSourceRow || 0);
      const rowB = Number(b.bankSourceRow || 0);
      if (rowA !== rowB) return rowA - rowB;
      return a.document.localeCompare(b.document, 'pt-BR', { numeric: true });
    });
    extras.sort((a, b) => a.document.localeCompare(b.document, 'pt-BR', { numeric: true }));

    const bankTotalCents = bank.reduce((sum, r) => sum + (r.valueCents || 0), 0);
    const dealerTotalCents = dealer.reduce((sum, r) => sum + (r.valueCents || 0), 0);
    const summary = {
      date,
      bankCount: bank.length,
      dealerCount: dealer.length,
      bankTotalCents,
      dealerTotalCents,
      exactCount: results.filter((r) => r.status === 'OK').length,
      divergenceCount: results.filter((r) => r.status === 'DIVERGENCIA').length,
      missingCount: results.filter((r) => r.status === 'DEALER').length,
      missingTotalCents: results.filter((r) => r.status === 'DEALER').reduce((sum, r) => sum + (r.bankValueCents || 0), 0),
      divergenceNetCents: results.filter((r) => r.status === 'DIVERGENCIA').reduce((sum, r) => sum + (r.differenceCents || 0), 0),
      extraDealerCount: extras.length,
      totalNetDifferenceCents: bankTotalCents - dealerTotalCents,
    };

    return { date, results, extras, summary };
  }

  return {
    normalizeText,
    normalizeDocument,
    parseMoney,
    formatMoney,
    normalizeDate,
    dateSortKey,
    parseDealerText,
    reconcileDay,
  };
});
