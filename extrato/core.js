/* Extrato do mês · leitura de extrato bancário em PDF (v1.0)
   Entrada: itens de texto com posição, como o pdf.js entrega ({ str, x, y, w, page }).
   Saída: colunas de valores encontradas e lançamentos (data, descrição, valores por coluna). */
(function (global) {
  'use strict';

  var MONEY = /^\(?-?(?:R\$)?\d{1,3}(?:\.\d{3})*,\d{2}\)?-?$/;
  var DATE = /^(\d{2})\/(\d{2})(?:\/(\d{2}|\d{4}))?$/;
  var MONTHS = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

  function parseMoney(s) {
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
    var n = parseFloat(s.replace(/[^\d,]/g, '').replace(',', '.'));
    if (!isFinite(n)) return null;
    return Math.round((neg ? -n : n) * 100) / 100;
  }

  // Quebra cada item do PDF em palavras com posição aproximada.
  function tokenize(items) {
    var out = [];
    items.forEach(function (it) {
      var str = String(it.str || '');
      if (!str.trim()) return;
      var len = str.length, cw = len ? (it.w || 0) / len : 0;
      var re = /\S+/g, m;
      while ((m = re.exec(str))) {
        out.push({ t: m[0], x0: it.x + m.index * cw, x1: it.x + (m.index + m[0].length) * cw, y: it.y, page: it.page });
      }
    });
    return out;
  }

  // Agrupa palavras em linhas (mesma página, mesma altura).
  function groupLines(tokens) {
    var sorted = tokens.slice().sort(function (a, b) { return a.page - b.page || b.y - a.y || a.x0 - b.x0; });
    var lines = [];
    sorted.forEach(function (t) {
      var line = lines[lines.length - 1];
      if (!line || line.page !== t.page || Math.abs(line.y - t.y) > 3) {
        line = { page: t.page, y: t.y, tokens: [] };
        lines.push(line);
      }
      line.tokens.push(t);
    });
    lines.forEach(function (l) { l.tokens.sort(function (a, b) { return a.x0 - b.x0; }); });
    return lines;
  }

  // Junta "R$", sinal e sufixo D/C ao número; marca datas e valores.
  function classify(line) {
    var toks = line.tokens, out = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], txt = t.t, x0 = t.x0, x1 = t.x1;
      // "R$", "-", "+" ou "-R$" separados do número.
      if ((txt === 'R$' || txt === '-' || txt === '+' || txt === '-R$') && toks[i + 1] && MONEY.test(toks[i + 1].t.replace(/^(-?)R\$/, '$1'))) {
        var nx = toks[i + 1];
        txt = (txt.charAt(0) === '-' ? '-' : '') + nx.t; x1 = nx.x1; i++;
      }
      var clean = txt.replace(/^(-?)R\$/, '$1').replace(/^--/, '-');
      if (MONEY.test(clean)) {
        var val = parseMoney(clean);
        var suf = toks[i + 1] && /^[DC-]$/i.test(toks[i + 1].t) && (toks[i + 1].x0 - x1) < 12 ? toks[i + 1].t.toUpperCase() : '';
        if (suf) { i++; x1 = toks[i].x1; if ((suf === 'D' || suf === '-') && val > 0) val = -val; }
        out.push({ kind: 'money', t: txt, v: val, x0: x0, x1: x1 });
      } else if (DATE.test(txt)) {
        out.push({ kind: 'date', t: txt, x0: x0, x1: x1 });
      } else {
        out.push({ kind: 'text', t: txt, x0: x0, x1: x1 });
      }
    }
    return out;
  }

  function clusterEdges(edges, tol) {
    edges.sort(function (a, b) { return a - b; });
    var groups = [];
    edges.forEach(function (x) {
      var g = groups[groups.length - 1];
      if (g && x - g.max <= tol) { g.items.push(x); g.max = x; }
      else groups.push({ items: [x], max: x });
    });
    return groups.map(function (g) {
      var sum = g.items.reduce(function (s, v) { return s + v; }, 0);
      return { x: sum / g.items.length, min: g.items[0], max: g.max, count: g.items.length };
    });
  }

  function guessPeriod(lines, rows) {
    var text = lines.map(function (l) { return l.tokens.map(function (t) { return t.t; }).join(' '); }).join(' \n ').toLowerCase();
    var years = {}, m;
    var reFull = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;
    while ((m = reFull.exec(text))) years[m[3] + '-' + m[2]] = (years[m[3] + '-' + m[2]] || 0) + 1;
    var reMY = /\b(\d{2})\/(\d{4})\b/g;
    while ((m = reMY.exec(text))) years[m[2] + '-' + m[1]] = (years[m[2] + '-' + m[1]] || 0) + 1;
    var reName = /\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?\s*(?:de\s+|\/\s*)?(\d{4})\b/g;
    while ((m = reName.exec(text))) {
      var k = m[2] + '-' + String(MONTHS[m[1]]).padStart(2, '0');
      years[k] = (years[k] || 0) + 1;
    }
    // Mês mais frequente entre os lançamentos.
    var monthCount = {};
    rows.forEach(function (r) { monthCount[r.mm] = (monthCount[r.mm] || 0) + 1; });
    var mm = Object.keys(monthCount).sort(function (a, b) { return monthCount[b] - monthCount[a]; })[0];
    var yyyy = null;
    rows.forEach(function (r) { if (!yyyy && r.yyyy && r.mm === mm) yyyy = r.yyyy; });
    if (!yyyy && mm) {
      var best = Object.keys(years).filter(function (k) { return k.slice(5) === mm; }).sort(function (a, b) { return years[b] - years[a]; })[0];
      if (best) yyyy = best.slice(0, 4);
    }
    if (!mm) {
      var any = Object.keys(years).sort(function (a, b) { return years[b] - years[a]; })[0];
      return any || '';
    }
    return yyyy ? yyyy + '-' + mm : '';
  }

  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function parseStatement(items) {
    var lines = groupLines(tokenize(items));
    lines.forEach(function (l) { l.cells = classify(l); });

    // 1) Linhas candidatas: têm valor e (data na linha ou data anterior).
    var seenDate = false;
    lines.forEach(function (l) {
      var hasDate = l.cells.slice(0, 3).some(function (c) { return c.kind === 'date'; });
      if (hasDate) seenDate = true;
      l.candidate = seenDate && l.cells.some(function (c) { return c.kind === 'money'; });
    });

    // 2) Colunas de valor: bordas direitas alinhadas.
    var edges = [];
    lines.forEach(function (l) { if (l.candidate) l.cells.forEach(function (c) { if (c.kind === 'money') edges.push(c.x1); }); });
    var candidateCount = lines.filter(function (l) { return l.candidate; }).length;
    var minCount = Math.max(2, Math.floor(candidateCount * 0.04));
    var cols = clusterEdges(edges, 14).filter(function (g) { return g.count >= minCount; }).sort(function (a, b) { return a.x - b.x; });
    if (!cols.length) return { columns: [], rows: [], period: '', lineCount: lines.length };

    function colOf(cell) {
      var best = -1, dist = 1e9;
      cols.forEach(function (g, i) { var d = Math.abs(cell.x1 - g.x); if (d < dist) { dist = d; best = i; } });
      return dist <= 22 ? best : -1;
    }

    // 3) Nomes das colunas pelo cabeçalho.
    var names = cols.map(function () { return ''; });
    var firstRowLine = lines.filter(function (l) { return l.candidate; })[0];
    var headerLine = null, headerScore = 0;
    lines.forEach(function (l) {
      if (l.candidate || l.page !== firstRowLine.page || l.y < firstRowLine.y) return;
      var score = 0;
      cols.forEach(function (g) {
        if (l.cells.some(function (c) { return c.kind === 'text' && /[a-zà-ú]/i.test(c.t) && c.x1 >= g.min - 70 && c.x0 <= g.max + 10; })) score++;
      });
      if (score > headerScore || (score === headerScore && headerLine && l.y < headerLine.y && score)) { headerScore = score; headerLine = l; }
    });
    if (headerLine) {
      var prevRight = -1e9;
      cols.forEach(function (g, i) {
        var words = headerLine.cells.filter(function (c) {
          return c.kind === 'text' && c.x1 >= g.min - 70 && c.x0 <= g.max + 10 && c.x0 > prevRight - 2;
        });
        if (words.length) { names[i] = words.map(function (c) { return c.t; }).join(' ').replace(/[():]/g, '').trim(); prevRight = words[words.length - 1].x1; }
      });
    }
    var used = {};
    var columns = cols.map(function (g, i) {
      var name = names[i] || (cols.length === 1 ? 'Valor' : 'Coluna ' + (i + 1));
      if (name === name.toUpperCase()) name = name.charAt(0) + name.slice(1).toLowerCase();
      name = name.replace(/\s*R\$$/, '').trim() || name;
      if (used[name]) name += ' ' + (i + 1);
      used[name] = 1;
      return { id: 'c' + i, name: name, saldo: /saldo/i.test(name) };
    });

    // 4) Colunas de texto pelo cabeçalho (Lançamentos, Razão Social, CNPJ/CPF...).
    var textCols = [];
    if (headerLine) {
      var moneyLeft = Math.min.apply(null, cols.map(function (g) { return g.min; })) - 75;
      var words = headerLine.cells.filter(function (c) { return c.kind === 'text' && c.x1 < moneyLeft; });
      words.forEach(function (w) {
        var last = textCols[textCols.length - 1];
        if (last && w.x0 - last.x1 < 9) { last.label += ' ' + w.t; last.x1 = w.x1; }
        else textCols.push({ label: w.t, x0: w.x0, x1: w.x1 });
      });
      textCols.forEach(function (t) {
        t.role = /^(data|dt)\b/i.test(t.label) ? 'date'
          : /raz[aã]o|favorecido|benefici|nome|pagador/i.test(t.label) ? 'party'
          : /cpf|cnpj/i.test(t.label) ? 'taxId'
          : /origem|ag[eê]ncia|^ag\b/i.test(t.label) ? 'origin'
          : 'hist';
      });
    }
    var useCols = textCols.filter(function (t) { return t.role !== 'date'; }).length >= 2;
    function roleOf(c) {
      var r = null;
      textCols.forEach(function (t) { if (c.x0 >= t.x0 - 4) r = t; });
      return r ? r.role : 'hist';
    }

    // 5) Lançamentos (linha com data/valor) e linhas de texto que pertencem a eles.
    var rows = [], lastDate = null, occ = {}, rowLines = [];
    lines.forEach(function (l, li) {
      var dateCell = l.cells.slice(0, 3).filter(function (c) { return c.kind === 'date'; })[0];
      var hasMoney = l.cells.some(function (c) { return c.kind === 'money'; });
      if (dateCell && hasMoney) {
        var dm = DATE.exec(dateCell.t);
        var yy = dm[3] ? (dm[3].length === 2 ? '20' + dm[3] : dm[3]) : null;
        lastDate = { dd: dm[1], mm: dm[2], yyyy: yy };
      } else dateCell = null;   // "28/10" sozinho numa linha é parte da descrição
      var values = {}, nValues = 0, texts = [];
      l.cells.forEach(function (c) {
        if (c === dateCell) return;
        if (c.kind === 'money') {
          var ci = colOf(c);
          if (ci >= 0 && values['c' + ci] === undefined) { values['c' + ci] = c.v; nValues++; return; }
        }
        texts.push({ c: c, y: l.y });
      });
      if (l.candidate && nValues && lastDate) {
        var row = { dd: lastDate.dd, mm: lastDate.mm, yyyy: lastDate.yyyy, values: values, page: l.page, y: l.y, parts: texts };
        rows.push(row); rowLines.push(li);
      } else {
        l.loose = texts;
      }
    });
    // Texto de células com mais de uma linha (acima ou abaixo da linha da data): vai para o lançamento mais próximo.
    var headerY = headerLine ? headerLine.y : Infinity;
    lines.forEach(function (l) {
      if (!l.loose || !l.loose.length || l === headerLine) return;
      if (headerLine && l.page === headerLine.page && l.y >= headerY) return;
      var best = null, dist = 1e9;
      rows.forEach(function (r) { if (r.page !== l.page) return; var d = Math.abs(r.y - l.y); if (d < dist) { dist = d; best = r; } });
      if (!best || dist > 12) return;
      var txt = l.loose.map(function (x) { return x.c.t; }).join(' ');
      if (txt.length > 140) return;
      best.parts = best.parts.concat(l.loose);
    });
    rows.forEach(function (r) {
      // Ordem de leitura: de cima para baixo, da esquerda para a direita.
      r.parts.sort(function (a, b) { return (b.y - a.y) || (a.c.x0 - b.c.x0); });
      var f = { hist: [], party: [], taxId: [], origin: [] };
      r.parts.forEach(function (x) { var role = useCols ? roleOf(x.c) : 'hist'; if (role === 'date') role = 'hist'; f[role].push(x.c.t); });
      var j = function (a) { return a.join(' ').replace(/\s+/g, ' ').trim(); };
      r.hist = j(f.hist); r.party = j(f.party); r.taxId = j(f.taxId); r.origin = j(f.origin);
      r.desc = [r.hist, r.party].filter(Boolean).join(' · ');
      r.extra = [r.origin ? 'Ag/origem ' + r.origin : '', r.taxId ? 'CPF/CNPJ ' + r.taxId : ''].filter(Boolean).join(' · ');
      r.saldo = /\bsaldo\b/i.test(r.desc);
      var sig = r.dd + '/' + r.mm + '|' + r.desc + '|' + JSON.stringify(r.values);
      occ[sig] = (occ[sig] || 0) + 1;
      r.id = hash(sig + '#' + occ[sig]);
      delete r.parts;
    });

    var period = guessPeriod(lines, rows);
    rows.forEach(function (r) {
      var y = r.yyyy || (period ? period.slice(0, 4) : '');
      r.date = r.dd + '/' + r.mm + (y ? '/' + y : '');
      delete r.y; delete r.page;
    });
    return markSaldoAt(normalizeSigns({ columns: columns, rows: rows, period: period, lineCount: lines.length }));
  }

  // Opções de soma: a coluna inteira e, quando tem valores positivos e negativos, só entradas / só saídas.
  function sumOptions(columns, rows) {
    var opts = [];
    columns.forEach(function (c) {
      if (c.saldo) return; // saldo não se soma: vira "Saldo inicial / Saldo final"
      var pos = false, neg = false;
      rows.forEach(function (r) { var v = r.values[c.id]; if (v > 0) pos = true; if (v < 0) neg = true; });
      opts.push({ key: c.name + '|all', col: c.id, mode: 'all', label: c.name, saldo: c.saldo });
      if (pos && neg && !c.saldo) {
        var plain = /^valor$/i.test(c.name);
        opts.push({ key: c.name + '|pos', col: c.id, mode: 'pos', label: plain ? 'Entradas' : c.name + ' · entradas', saldo: false });
        opts.push({ key: c.name + '|neg', col: c.id, mode: 'neg', label: plain ? 'Saídas' : c.name + ' · saídas', saldo: false });
      }
    });
    return opts;
  }
  function defaultSumKeys(columns, rows) {
    var opts = sumOptions(columns, rows);
    var named = opts.filter(function (o) { return o.mode === 'all' && /entrada|cr[eé]dito|sa[ií]da|d[eé]bito/i.test(o.label); });
    if (named.length) return named.map(function (o) { return o.key; });
    var split = opts.filter(function (o) { return o.mode !== 'all'; });
    if (split.length) return split.slice(0, 2).map(function (o) { return o.key; });
    var first = opts.filter(function (o) { return !o.saldo; })[0];
    return first ? [first.key] : [];
  }
  function applySum(opt, rows) {
    return Math.round(rows.reduce(function (s, r) {
      var v = r.values[opt.col];
      if (typeof v !== 'number') return s;
      if (opt.mode === 'pos' && v <= 0) return s;
      if (opt.mode === 'neg' && v >= 0) return s;
      return s + v;
    }, 0) * 100) / 100;
  }


  /* ---------------- Excel / CSV ----------------
     Entrada: matriz de linhas (SheetJS sheet_to_json com header: 1, cellDates: true). */
  var HDR_DATE = /^(data|dt)\b|data\s+(do\s+)?(lan[cç]amento|movimento|mov)/i;
  var HDR_DESC = /hist[oó]rico|descri[cç][aã]o|lan[cç]amento|complemento|detalhe|opera[cç][aã]o/i;
  var HDR_MONEY = /valor|cr[eé]dito|d[eé]bito|entrada|sa[ií]da|saldo|montante|movimenta/i;
  var HDR_DOC = /documento|^doc\b|n[uú]mero|^n[ºo°]|cpf|cnpj|ag\.?\s*\/?\s*origem|^ag[eê]ncia|^origem/i;
  var HDR_NAME = /raz[aã]o\s+social|favorecido|benefici|pagador|remetente|contraparte|^nome/i;

  function cellText(v) {
    if (v == null) return '';
    if (v instanceof Date) return '';
    return String(v).trim();
  }
  function cellDate(v) {
    if (v instanceof Date && !isNaN(v)) {
      // SheetJS cria a data no fuso local; usa os componentes locais.
      return { dd: String(v.getDate()).padStart(2, '0'), mm: String(v.getMonth() + 1).padStart(2, '0'), yyyy: String(v.getFullYear()) };
    }
    if (typeof v === 'number' && v > 30000 && v < 80000) {
      var d = new Date(Math.round((v - 25569) * 86400000));
      return { dd: String(d.getUTCDate()).padStart(2, '0'), mm: String(d.getUTCMonth() + 1).padStart(2, '0'), yyyy: String(d.getUTCFullYear()) };
    }
    var m = /^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/.exec(cellText(v));
    if (!m) return null;
    var y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : null;
    return { dd: m[1].padStart(2, '0'), mm: m[2].padStart(2, '0'), yyyy: y };
  }
  function cellMoney(v) {
    if (typeof v === 'number' && isFinite(v)) return Math.round(v * 100) / 100;
    var t = cellText(v).replace(/\s+/g, '');
    if (!t) return null;
    var suf = /[DC]$/i.test(t) ? t.slice(-1).toUpperCase() : '';
    if (suf) t = t.slice(0, -1);
    t = t.replace(/^(-?)R\$/, '$1');
    if (MONEY.test(t)) { var n = parseMoney(t); return suf === 'D' && n > 0 ? -n : n; }
    if (/^-?\d+(\.\d+)?$/.test(t)) { var f = parseFloat(t); return suf === 'D' && f > 0 ? -f : f; }
    return null;
  }

  function parseSheet(matrix) {
    var rowsIn = (matrix || []).filter(function (r) { return Array.isArray(r); });
    var width = rowsIn.reduce(function (w, r) { return Math.max(w, r.length); }, 0);

    // 1) Cabeçalho: linha com "Data" e pelo menos uma coluna de valor.
    var hIdx = -1;
    for (var i = 0; i < Math.min(rowsIn.length, 40); i++) {
      var cells = rowsIn[i].map(cellText);
      if (cells.some(function (c) { return HDR_DATE.test(c); }) && cells.some(function (c) { return HDR_MONEY.test(c) && !HDR_DATE.test(c); })) { hIdx = i; break; }
    }
    var header = hIdx >= 0 ? rowsIn[hIdx].map(cellText) : [];
    var body = rowsIn.slice(hIdx + 1);

    // 2) Coluna de data: pelo nome; se não houver, a que mais tem datas.
    var dateCol = header.findIndex(function (c) { return HDR_DATE.test(c); });
    if (dateCol < 0) {
      var best = -1, bestN = 0;
      for (var c = 0; c < width; c++) {
        var n = body.filter(function (r) { return cellDate(r[c]); }).length;
        if (n > bestN) { bestN = n; best = c; }
      }
      dateCol = best;
    }
    if (dateCol < 0) return { columns: [], rows: [], period: '' };

    // 3) Colunas de valor: nome de valor ou maioria numérica nas linhas com data.
    var dated = body.filter(function (r) { return cellDate(r[dateCol]); });
    var moneyCols = [], descCols = [], nameCols = [], docCols = [];
    for (var k = 0; k < width; k++) {
      if (k === dateCol) continue;
      var name = header[k] || '';
      var filled = dated.filter(function (r) { return cellText(r[k]) !== '' || typeof r[k] === 'number'; });
      var numeric = filled.filter(function (r) { return cellMoney(r[k]) !== null; }).length;
      var looksMoney = HDR_MONEY.test(name) && !HDR_DOC.test(name);
      if (looksMoney || (!HDR_DESC.test(name) && !HDR_DOC.test(name) && !HDR_NAME.test(name) && filled.length && numeric / filled.length > 0.8 && dated.some(function (r) { var v = cellMoney(r[k]); return v !== null && Math.round(v) !== v; }))) {
        moneyCols.push(k);
      } else if (!filled.length) {
        continue;
      } else if (HDR_NAME.test(name)) {
        nameCols.push(k);
      } else if (HDR_DOC.test(name)) {
        docCols.push(k);
      } else {
        descCols.push(k);
      }
    }
    if (!moneyCols.length) return { columns: [], rows: [], period: '' };
    var used = {};
    var columns = moneyCols.map(function (k, i) {
      var nm = (header[k] || (moneyCols.length === 1 ? 'Valor' : 'Coluna ' + (i + 1))).replace(/\s*\(?R\$\)?\s*/g, ' ').replace(/[():]/g, '').trim() || 'Valor';
      if (nm === nm.toUpperCase()) nm = nm.charAt(0) + nm.slice(1).toLowerCase();
      if (used[nm]) nm += ' ' + (i + 1);
      used[nm] = 1;
      return { id: 'c' + i, name: nm, saldo: /saldo/i.test(nm), _k: k };
    });

    // 4) Lançamentos.
    var rows = [], occ = {}, last = null;
    body.forEach(function (r) {
      var d = cellDate(r[dateCol]);
      if (d) last = d;
      var values = {}, n = 0;
      columns.forEach(function (col) {
        var v = cellMoney(r[col._k]);
        if (v !== null && v !== 0) { values[col.id] = v; n++; }
        else if (v === 0 && col.saldo) { values[col.id] = 0; }
      });
      if (!n || !last) return;
      var txt = function (cols) { return cols.map(function (k) { return cellText(r[k]); }).filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim(); };
      var desc = [txt(descCols), txt(nameCols)].filter(Boolean).join(' · ');
      var extra = docCols.map(function (k) { var v = cellText(r[k]); return v ? (header[k] ? header[k] + ' ' : '') + v : ''; }).filter(Boolean).join(' · ');
      if (!d && !desc) return;
      var sig = last.dd + '/' + last.mm + '|' + desc + '|' + JSON.stringify(values);
      occ[sig] = (occ[sig] || 0) + 1;
      var docOf = function (re) { var k = docCols.filter(function (x) { return re.test(header[x] || ''); })[0]; return k === undefined ? '' : cellText(r[k]); };
      rows.push({ id: hash(sig + '#' + occ[sig]), dd: last.dd, mm: last.mm, yyyy: last.yyyy, desc: desc, extra: extra, values: values, saldo: /\bsaldo\b/i.test(desc),
        hist: txt(descCols), party: txt(nameCols), taxId: docOf(/cpf|cnpj/i), origin: docOf(/origem|ag/i) });
    });
    columns.forEach(function (c) { delete c._k; });

    // 5) Mês: o mais frequente entre os lançamentos.
    var cnt = {};
    rows.forEach(function (r) { if (r.yyyy) { var key = r.yyyy + '-' + r.mm; cnt[key] = (cnt[key] || 0) + 1; } });
    var period = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0] || '';
    rows.forEach(function (r) { r.date = r.dd + '/' + r.mm + (r.yyyy ? '/' + r.yyyy : ''); });
    return markSaldoAt(normalizeSigns({ columns: columns, rows: rows, period: period }));
  }

  // Agência e conta no cabeçalho do PDF (para identificar a empresa).
  function findAccount(items) {
    var text = items.map(function (it) { return it.str; }).join(' ').replace(/\s+/g, ' ');
    var ag = /ag[eê]ncia\s*[:.\-]?\s*(\d{3,5})/i.exec(text) || /\bag\.?\s*[:\-]?\s*(\d{3,5})\b/i.exec(text);
    var cc = /conta(?:\s+corrente)?\s*[:.\-]?\s*(\d[\d.\-]{3,15}\d)/i.exec(text) || /\bc\/?c\.?\s*[:\-]?\s*(\d[\d.\-]{3,15}\d)/i.exec(text);
    if (!ag || !cc) return '';
    return ag[1] + '/' + cc[1].replace(/\D/g, '');
  }

  // Coluna Débito/Saída é sempre saída (negativo); Crédito/Entrada é sempre entrada (positivo).
  function normalizeSigns(result) {
    result.columns.forEach(function (c) {
      c.name = c.name.charAt(0).toUpperCase() + c.name.slice(1);
      var out = /sa[ií]da|d[eé]bito/i.test(c.name), inn = !out && /entrada|cr[eé]dito/i.test(c.name);
      if (c.saldo || (!out && !inn)) return;
      result.rows.forEach(function (r) {
        var v = r.values[c.id];
        if (typeof v === 'number') r.values[c.id] = out ? -Math.abs(v) : Math.abs(v);
      });
    });
    return result;
  }

  // "SALDO ANTERIOR" com lançamentos no mesmo dia (no próprio arquivo) é o saldo do início do dia;
  // nos demais casos, a linha de saldo é o saldo do fim do dia.
  function markSaldoAt(result) {
    var movDays = {};
    result.rows.forEach(function (r) { if (!r.saldo) movDays[r.dd + '/' + r.mm] = 1; });
    result.rows.forEach(function (r) {
      if (r.saldo) r.saldoAt = /anterior/i.test(r.desc) && movDays[r.dd + '/' + r.mm] ? 'start' : 'end';
    });
    return result;
  }

  global.ExtratoCore = { parseStatement: parseStatement, parseSheet: parseSheet, findAccount: findAccount, hash: hash, sumOptions: sumOptions, defaultSumKeys: defaultSumKeys, applySum: applySum, parseMoney: parseMoney };
})(typeof window !== 'undefined' ? window : globalThis);
