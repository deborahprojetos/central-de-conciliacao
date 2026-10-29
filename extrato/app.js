/* Extrato do mês · tela (v1.0)
   Dados salvos por empresa em localStorage: cf:extrato:<empresa>
   { months: { 'AAAA-MM': { fileName, importedAt, columns, rows, marks: { idLançamento: { status, resp, at } } } },
     lastMonth, prefs: {}, ui: { day, type, cf, sort } } */
(function () {
  'use strict';

  var Shell = window.CentralShell, Core = window.ExtratoCore;
  var $ = function (id) { return document.getElementById(id); };
  var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var STATUSES = ['Pendente', 'Em análise'];

  var company = Shell ? Shell.company() : null;
  var KEY = company ? 'cf:extrato:' + company : null;
  var state = load();
  (function migrateFilters() {
    var ui = state.ui || (state.ui = {});
    if (ui.status) { ui.cf = ui.cf || {}; ui.cf.status = [ui.status === '-' ? '(Sem status)' : ui.status]; }
    if (ui.resp) { ui.cf = ui.cf || {}; ui.cf.resp = [ui.resp === '-' ? '(Vazias)' : ui.resp]; }
    delete ui.status; delete ui.resp;
  })();
  var pending = null; // extrato lido e ainda não salvo

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function loadFor(co) {
    var empty = { months: {}, lastMonth: '', prefs: {}, ui: {} };
    if (!co) return empty;
    try {
      var s = JSON.parse(localStorage.getItem('cf:extrato:' + co) || 'null');
      if (s && s.months) { s.prefs = s.prefs || {}; s.ui = s.ui || {}; return s; }
    } catch (e) {}
    return empty;
  }
  function saveFor(co, st) {
    if (!co) return false;
    try { localStorage.setItem('cf:extrato:' + co, JSON.stringify(st)); return true; }
    catch (e) { message('Não foi possível salvar: o armazenamento do navegador está cheio.', 'error'); return false; }
  }
  function load() { return loadFor(company); }
  function save() { saveFor(company, state); }
  function message(text, kind) {
    var el = $('importMsg');
    el.hidden = !text; el.textContent = text || '';
    el.className = 'ex-msg' + (kind ? ' is-' + kind : '');
  }
  function monthLabel(key) {
    var m = /^(\d{4})-(\d{2})$/.exec(key || '');
    if (!m) return key || '';
    var name = new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  function current() { return state.months[state.lastMonth] || null; }

  /* ---------------- Importação ---------------- */
  async function readPdf(file) {
    if (!window.pdfjsLib) throw new Error('O leitor de PDF não carregou. Verifique a conexão e tente de novo.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    var items = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var content = await page.getTextContent();
      content.items.forEach(function (it) {
        if (!it.str || !it.str.trim()) return;
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, page: p });
      });
    }
    return items;
  }

  function fileKind(name) {
    var n = String(name || '').toLowerCase();
    if (/\.pdf$/.test(n)) return 'pdf';
    if (/\.(xlsx|xlsm|xls|csv)$/.test(n)) return 'sheet';
    return '';
  }
  // Alguns bancos gravam no arquivo um tamanho de planilha menor que o real (ex.: "A1:G13"
  // com dados até a linha 181). Recalcula pelo conteúdo para não perder lançamentos.
  function fixRange(ws) {
    if (!ws) return;
    var maxR = -1, maxC = -1;
    Object.keys(ws).forEach(function (k) {
      if (k.charAt(0) === '!') return;
      var a = XLSX.utils.decode_cell(k);
      if (a.r > maxR) maxR = a.r;
      if (a.c > maxC) maxC = a.c;
    });
    if (maxR >= 0) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  }
  // Lê PDF ou Excel e devolve { columns, rows, period, account }.
  async function readAny(file) {
    var kind = fileKind(file.name);
    if (kind === 'pdf') {
      var items = await readPdf(file);
      if (!items.length) throw new Error('PDF sem texto selecionável (imagem).');
      var p = Core.parseStatement(items);
      p.account = Core.findAccount(items.filter(function (it) { return it.page === 1; }));
      return p;
    }
    if (kind === 'sheet') {
      if (!window.XLSX) throw new Error('O leitor de Excel não carregou. Verifique a conexão e tente de novo.');
      var wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      var best = null;
      wb.SheetNames.forEach(function (n) {
        fixRange(wb.Sheets[n]);
        var matrix = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
        var r = Core.parseSheet(matrix);
        if (!best || r.rows.length > best.rows.length) {
          best = r;
          var top = matrix.slice(0, 15).map(function (row) { return { str: row.join(' '), page: 1 }; });
          best.account = Core.findAccount(top);
        }
      });
      return best || { columns: [], rows: [], period: '' };
    }
    throw new Error('Formato não aceito. Use PDF ou Excel.');
  }

  // Junta um arquivo ao mês. Cada origem (src) substitui só os próprios lançamentos.
  function rowSig(r) { return r.day + '|' + r.desc + '|' + Object.keys(r.values).sort().map(function (k) { return r.values[k]; }).join(';'); }
  function mergeImport(st, m, fileName, parsed, src, label, opts) {
    src = src || '';
    opts = opts || {};
    var old = st.months[m];
    var oldMarks = (old && old.marks) || {};
    // Leva status e responsáveis de lançamentos substituídos para os mesmos lançamentos no arquivo novo.
    function moveMarks(removed, incoming) {
      var bySig = {};
      incoming.forEach(function (r) { var k = rowSig(r); (bySig[k] = bySig[k] || []).push(r); });
      removed.forEach(function (r) {
        if (!oldMarks[r.id]) return;
        var list = bySig[rowSig(r)];
        if (!list || !list.length) { delete oldMarks[r.id]; return; }
        var same = list.filter(function (x) { return x.id === r.id; })[0];
        var to = same || list[0];
        list.splice(list.indexOf(to), 1);
        if (to.id === r.id) return;                 // mesmo lançamento, mesmo identificador
        if (!oldMarks[to.id]) oldMarks[to.id] = oldMarks[r.id];
        delete oldMarks[r.id];
      });
    }
    // Conta bancária identificada no arquivo: todos os arquivos dessa conta formam uma só origem.
    if (parsed.account) {
      var acct = 'conta:' + parsed.account;
      if (old && old.sources) {
        Object.keys(old.sources).forEach(function (k) {
          if (k === acct) return;
          if (old.sources[k].account === parsed.account || k === src) {
            old.rows.forEach(function (r) { if ((r.src || '') === k) r.src = acct; });
            if (!old.sources[acct]) old.sources[acct] = old.sources[k];
            delete old.sources[k];
          }
        });
      }
      src = acct;
    } else if (old && old.rows.length) {
      // Arquivo sem agência/conta (ex.: cabeçalho do banco apagado): se os lançamentos dos dias em comum
      // são os mesmos de uma conta já importada, é a mesma conta.
      // Assinatura independente da ordem das colunas: dia | descrição | valores.
      var loose = function (day, desc, values) { return day + '|' + desc + '|' + Object.keys(values).map(function (k) { return values[k]; }).sort(function (x, y) { return x - y; }).join(';'); };
      var inSig = {}, inDays = {};
      parsed.rows.forEach(function (r) {
        if (r.saldo) return;
        var day = r.dd + '/' + r.mm, g = loose(day, r.desc, r.values);
        inSig[g] = (inSig[g] || 0) + 1; inDays[day] = 1;
      });
      var best = null, bestScore = 0;
      Object.keys(old.sources || { '': 1 }).forEach(function (k) {
        if (k === src) return;
        var theirs = old.rows.filter(function (r) { return (r.src || '') === k && !r.saldo && inDays[r.day]; });
        if (theirs.length < 3) return;
        var left = Object.assign({}, inSig), same = 0;
        theirs.forEach(function (r) { var g = loose(r.day, r.desc, r.values); if (left[g]) { left[g]--; same++; } });
        var score = same / theirs.length;
        if (score >= 0.8 && score > bestScore) { best = k; bestScore = score; }
      });
      if (best !== null) {
        if (old.sources && old.sources[src] && src !== best) {
          old.rows.forEach(function (r) { if ((r.src || '') === src) r.src = best; });
          delete old.sources[src];
        }
        parsed = Object.assign({}, parsed, { account: (old.sources && old.sources[best] && old.sources[best].account) || '' });
        src = best;
      }
    }
    var yyyy = m.slice(0, 4);
    var columns = old ? old.columns.slice() : [];
    var byName = {};
    columns.forEach(function (c) { byName[c.name.toLowerCase()] = c.id; });
    var remap = {};
    parsed.columns.forEach(function (c) {
      var k = c.name.toLowerCase();
      if (!byName[k]) {
        var id = 'c' + columns.length;
        while (columns.some(function (x) { return x.id === id; })) id += 'x';
        columns.push({ id: id, name: c.name, saldo: c.saldo });
        byName[k] = id;
      }
      remap[c.id] = byName[k];
    });
    var tag = src ? '.' + Core.hash(src) : '';
    var rows = parsed.rows.map(function (r) {
      var values = {};
      Object.keys(r.values).forEach(function (k) { values[remap[k]] = r.values[k]; });
      return { id: r.id + tag, date: r.dd + '/' + r.mm + '/' + (r.yyyy || yyyy), day: r.dd + '/' + r.mm, desc: r.desc, extra: r.extra || '', values: values, saldo: r.saldo, src: src,
        hist: r.hist || '', party: r.party || '', taxId: r.taxId || '', origin: r.origin || '', saldoAt: r.saldoAt || '' };
    });

    // Mesmo extrato em outro arquivo (ex.: .xls e .xlsx, ou versão mais completa): não soma duas vezes.
    var replaced = [];
    if (old) {
      var mineSigs = rows.filter(function (r) { return !r.saldo; }).map(rowSig);
      var mineCount = {};
      mineSigs.forEach(function (k) { mineCount[k] = (mineCount[k] || 0) + 1; });
      var srcList = Object.keys(old.sources || {});
      if (!old.sources && old.rows.length) srcList = [''];
      for (var si = 0; si < srcList.length; si++) {
        var k2 = srcList[si];
        if (k2 === src) continue;
        var theirs = old.rows.filter(function (r) { return (r.src || '') === k2 && !r.saldo; }).map(rowSig);
        if (!theirs.length || !mineSigs.length) continue;
        var left = Object.assign({}, mineCount), common = 0;
        theirs.forEach(function (k) { if (left[k]) { left[k]--; common++; } });
        var lbl = ((old.sources || {})[k2] || {}).label || old.fileName || k2;
        if (common === theirs.length && common === mineSigs.length) return { duplicate: lbl, kept: 0 };
        if (common === mineSigs.length) return { duplicate: lbl, contained: true, kept: 0 };
        if (common === theirs.length) { replaced.push(k2); continue; }           // este arquivo é mais completo
        if (!opts.force && common / Math.min(theirs.length, mineSigs.length) >= 0.5) return { conflict: lbl, overlap: common, kept: 0 };
      }
    }
    if (replaced.length) {
      moveMarks(old.rows.filter(function (r) { return replaced.indexOf(r.src || '') !== -1; }), rows);
      old.rows = old.rows.filter(function (r) { return replaced.indexOf(r.src || '') === -1; });
      replaced.forEach(function (k) { if (old.sources) delete old.sources[k]; });
    }

    if (old) {
      var seenSaldo = {};
      old.rows = old.rows.filter(function (r) {
        if (!r.saldo) return true;
        var k = (r.src || '') + '|' + rowSig(r);
        if (seenSaldo[k]) return false;
        seenSaldo[k] = 1; return true;
      });
    }
    var others = old ? old.rows.filter(function (r) { return (r.src || '') !== src; }) : [];
    // Mesmo arquivo com outro período (ex.: FRANCE.xlsx salvo de novo no dia seguinte):
    // atualiza só os dias que vieram no arquivo novo e mantém os dias anteriores.
    if (old) {
      var newDays = {};
      rows.forEach(function (r) { if (!r.saldo) newDays[r.day] = 1; });
      if (!Object.keys(newDays).length) rows.forEach(function (r) { newDays[r.day] = 1; });
      var keepOld = old.rows.filter(function (r) { return (r.src || '') === src && !newDays[r.day]; });
      moveMarks(old.rows.filter(function (r) { return (r.src || '') === src && newDays[r.day]; }), rows);
      var keptDays = {};
      keepOld.forEach(function (r) { keptDays[r.day] = 1; });
      rows = rows.filter(function (r) { return newDays[r.day] || !keptDays[r.day]; });
      others = others.concat(keepOld);
    }
    var all = others.concat(rows).map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
      return a.r.day.slice(0, 2) - b.r.day.slice(0, 2) || a.i - b.i;
    }).map(function (x) { return x.r; });
    var marks = oldMarks;
    var kept = rows.filter(function (r) { return marks[r.id]; }).length;
    var opts = Core.sumOptions(columns, all);
    var keep = ((old && old.sum) || []).filter(function (k) { return opts.some(function (o) { return o.key === k; }); });
    var sources = (old && old.sources) || {};
    if (old && !old.sources && others.length) sources[''] = { label: old.fileName, importedAt: old.importedAt };
    sources[src] = { label: label || fileName, fileName: fileName, account: parsed.account || '', importedAt: new Date().toISOString() };
    if (parsed.account) sources[src].label = (label || fileName) + ' · conta ' + parsed.account;
    st.months[m] = {
      fileName: fileName, importedAt: new Date().toISOString(), columns: columns, rows: all, marks: marks,
      sum: keep.length ? keep : Core.defaultSumKeys(columns, all), sources: sources
    };
    if (!st.lastMonth) st.lastMonth = m;
    return { kept: kept, rows: rows.length, existed: !!old, replaced: replaced.map(function (k) { return k; }) };
  }

  async function handleFile(file) {
    if (!file) return;
    if (!KEY) { message('Escolha a empresa antes de importar.', 'error'); return; }
    $('fileName').textContent = file.name;
    message('Lendo ' + file.name + '…');
    $('preview').hidden = true; pending = null;
    try {
      var parsed = await readAny(file);
      if (!parsed.rows.length) throw new Error('Nenhum lançamento com data e valor foi encontrado neste arquivo.');
      pending = { fileName: file.name, parsed: parsed };
      var period = parsed.period || new Date().toISOString().slice(0, 7);
      $('previewTitle').textContent = parsed.rows.filter(function (x) { return !x.saldo; }).length + ' lançamentos encontrados';
      $('previewCols').textContent = 'Colunas: ' + parsed.columns.map(function (c) { return c.name; }).join(', ');
      $('previewMonth').value = period;
      updateSaveLabel();
      $('preview').hidden = false;
      message('');
    } catch (err) {
      message(err && err.message ? err.message : 'Não foi possível ler o PDF.', 'error');
    } finally {
      $('pdfFile').value = '';
    }
  }
  function updateSaveLabel() {
    var m = $('previewMonth').value;
    $('saveImport').textContent = state.months[m] ? 'Atualizar ' + monthLabel(m) : 'Salvar extrato';
  }
  function commitImport() {
    if (!pending) return;
    var m = $('previewMonth').value;
    if (!/^\d{4}-\d{2}$/.test(m)) { message('Informe o mês do extrato.', 'error'); return; }
    var res = mergeImport(state, m, pending.fileName, pending.parsed, '', pending.fileName, { force: pending.force });
    if (res.duplicate) { message('Não importado: mesmo conteúdo de ' + res.duplicate + '.', 'error'); return; }
    if (res.conflict) {
      if (!window.confirm(res.overlap + ' lançamentos deste arquivo já estão em ' + res.conflict + '. Importar mesmo assim?')) return;
      pending.force = true; commitImport(); return;
    }
    var old = res.existed, keptMarks = res.kept;
    state.lastMonth = m;
    state.ui.day = '';
    save();
    pending = null;
    $('preview').hidden = true;
    $('fileName').textContent = 'Nenhum arquivo selecionado';
    message(monthLabel(m) + ' salvo' + (old ? ' · ' + keptMarks + ' marcações mantidas' : '') + '.', 'ok');
    render();
  }

  /* ---------------- Tela ---------------- */
  // Entrada ou saída: pelo nome da coluna (Entradas/Créditos, Saídas/Débitos) ou pelo sinal "-" do valor.
  function rowType(r, columns) {
    if (r.saldo) return '';
    var type = '';
    columns.forEach(function (c) {
      var v = r.values[c.id];
      if (type || c.saldo || typeof v !== 'number' || !v) return;
      if (/sa[ií]da|d[eé]bito/i.test(c.name)) type = 'saida';
      else if (/entrada|cr[eé]dito/i.test(c.name)) type = 'entrada';
      else type = v < 0 ? 'saida' : 'entrada';
    });
    return type;
  }
  /* ---- Colunas da tabela: cada uma sabe mostrar, ordenar e filtrar (como filtro de planilha) ---- */
  var NO_STATUS = '(Sem status)', EMPTY = '(Vazias)';
  function srcLabelOf(mo, r) { var x = (mo.sources || {})[r.src || '']; return x ? x.label : ''; }
  function tableCols(mo) {
    var multi = Object.keys(mo.sources || {}).length > 1;
    var hasParty = mo.rows.some(function (r) { return r.party; });
    var list = [{ key: 'date', label: 'Data', kind: 'date', text: function (r) { return r.day; }, sortVal: function (r) { return dayNum(r.day); } }];
    if (multi) list.push({ key: 'src', label: 'Arquivo', kind: 'text', text: function (r) { return srcLabelOf(mo, r) || EMPTY; } });
    if (hasParty) {
      list.push({ key: 'hist', label: 'Lançamento', kind: 'text', text: function (r) { return r.hist || r.desc || EMPTY; } });
      list.push({ key: 'party', label: 'Fornecedor', kind: 'text', text: function (r) { return r.party || EMPTY; } });
    } else {
      list.push({ key: 'desc', label: 'Descrição', kind: 'text', text: function (r) { return r.desc || EMPTY; } });
    }
    mo.columns.forEach(function (c) {
      list.push({ key: 'v:' + c.id, label: c.name, kind: 'num', col: c.id,
        text: function (r) { var v = r.values[c.id]; return typeof v === 'number' ? brl.format(v) : EMPTY; },
        sortVal: function (r) { var v = r.values[c.id]; return typeof v === 'number' ? v : null; } });
    });
    list.push({ key: 'status', label: 'Status', kind: 'text', text: function (r) { return (mo.marks[r.id] || {}).status || NO_STATUS; } });
    list.push({ key: 'resp', label: 'Responsável', kind: 'text', text: function (r) { return (mo.marks[r.id] || {}).resp || EMPTY; } });
    list.forEach(function (d) { if (!d.sortVal) d.sortVal = function (r) { var t = d.text(r); return t === EMPTY || t === NO_STATUS ? null : t.toLowerCase(); }; });
    return list;
  }
  function colFilters() { state.ui.cf = state.ui.cf || {}; return state.ui.cf; }
  function activeCf(exceptKey) { var cf = colFilters(); return Object.keys(cf).filter(function (k) { return k !== exceptKey && Array.isArray(cf[k]); }); }
  function sortRows(rows, defs) {
    var so = state.ui.sort;
    if (!so || !so.key) return rows;
    var d = defs.filter(function (x) { return x.key === so.key; })[0];
    if (!d) return rows;
    return rows.map(function (r, i) { return { r: r, i: i, v: d.sortVal(r) }; }).sort(function (a, b) {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;            // vazias sempre no fim, como na planilha
      if (b.v === null) return -1;
      var c = typeof a.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), 'pt-BR');
      return (c * so.dir) || a.i - b.i;
    }).map(function (x) { return x.r; });
  }

  function visibleRows(mo, exceptKey) {
    var ui = state.ui, day = ui.day || '', tp = ui.type || '';
    var q = $('search').value.trim().toLowerCase();
    var defs = tableCols(mo), cf = colFilters();
    var act = activeCf(exceptKey).map(function (k) { return { d: defs.filter(function (x) { return x.key === k; })[0], set: cf[k] }; }).filter(function (x) { return x.d; });
    return mo.rows.filter(function (r) {
      if (r.saldo) return false; // linhas de saldo nunca aparecem na tabela (o saldo fica nos cards e no rodapé)
      if (day && r.day !== day) return false;
      var mk = mo.marks[r.id] || {};
      if (tp && rowType(r, mo.columns) !== tp) return false;
      for (var i = 0; i < act.length; i++) if (act[i].set.indexOf(act[i].d.text(r)) === -1) return false;
      if (q && (r.desc + ' ' + (r.extra || '') + ' ' + (mk.resp || '') + ' ' + (((mo.sources || {})[r.src || ''] || {}).label || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  // Movimentos nunca incluem linhas de saldo.
  function sumBase(rows) { return rows.filter(function (r) { return !r.saldo; }); }
  function dayNum(d) { return Number(String(d).slice(0, 2)); }

  // Saldo de cada conta no fim de um dia = saldo de referência do banco + movimentos entre os dias.
  // dia vazio = período inteiro. Devolve { start, end, bank, diff, accounts }.
  // Saldo de cada conta = saldo do banco mais próximo do dia + lançamentos entre eles.
  // Cada saldo informado pelo banco é ligado ao seguinte; se não fecha, falta lançamento ou arquivo.
  // dia vazio = período inteiro. Devolve { start, end, ok, gaps: [{from,to,diff}], accounts }.
  function balances(mo, day) {
    var saldoCols = mo.columns.filter(function (c) { return c.saldo; }).map(function (c) { return c.id; });
    var moveCols = mo.columns.filter(function (c) { return !c.saldo; }).map(function (c) { return c.id; });
    if (!saldoCols.length) return null;
    var bySrc = {};
    mo.rows.forEach(function (r) { (bySrc[r.src || ''] = bySrc[r.src || ''] || []).push(r); });
    var out = { start: 0, end: 0, ok: true, gaps: [], accounts: 0, parts: [] };
    var r2 = function (v) { return Math.round(v * 100) / 100; };
    Object.keys(bySrc).forEach(function (k) {
      var rows = bySrc[k];
      var sval = function (r) { for (var i = 0; i < saldoCols.length; i++) { var v = r.values[saldoCols[i]]; if (typeof v === 'number') return v; } return null; };
      var mov = {};
      rows.forEach(function (r) {
        if (r.saldo) return;
        var v = moveCols.reduce(function (s, c) { return s + (typeof r.values[c] === 'number' ? r.values[c] : 0); }, 0);
        mov[dayNum(r.day)] = (mov[dayNum(r.day)] || 0) + v;
      });
      // Saldo no fim de cada dia, segundo o banco.
      var ref = {};
      rows.forEach(function (r) {
        if (!r.saldo || sval(r) === null) return;
        var d = dayNum(r.day);
        var at = r.saldoAt || (/anterior/i.test(r.desc) && mov[d] ? 'start' : 'end');
        if (at === 'start') { if (ref[d - 1] === undefined) ref[d - 1] = sval(r); }
        else if (/anterior/i.test(r.desc)) { if (ref[d] === undefined) ref[d] = sval(r); }
        else ref[d] = sval(r);   // linha do saldo do dia: vale a última do dia
      });
      var refDays = Object.keys(ref).map(Number).sort(function (a, b) { return a - b; });
      if (!refDays.length) return;
      var sumMov = function (from, to) { var t = 0; Object.keys(mov).forEach(function (x) { x = Number(x); if (x > from && x <= to) t += mov[x]; }); return t; };
      var endOf = function (d) {
        var before = refDays.filter(function (x) { return x <= d; });
        if (before.length) { var R = before[before.length - 1]; return r2(ref[R] + sumMov(R, d)); }
        var R2 = refDays[0]; return r2(ref[R2] - sumMov(d, R2));
      };
      // Conferência: cada saldo do banco + lançamentos até o próximo saldo do banco.
      for (var i = 1; i < refDays.length; i++) {
        var a = refDays[i - 1], b = refDays[i];
        var diff = r2(ref[a] + sumMov(a, b) - ref[b]);
        if (Math.abs(diff) >= 0.01) { out.ok = false; out.gaps.push({ from: a, to: b, diff: diff }); }
      }
      var movDays = Object.keys(mov).map(Number);
      var allDays = movDays.concat(refDays);
      var lastDay = Math.max.apply(null, allDays);
      var firstMov = movDays.length ? Math.min.apply(null, movDays) : refDays[0] + 1;
      var d = day ? dayNum(day) : lastDay;
      var start = day ? endOf(d - 1) : endOf(firstMov - 1);
      var srcInfo = (mo.sources || {})[k] || {};
      out.parts.push({ label: srcInfo.account ? 'conta ' + srcInfo.account : (srcInfo.label || 'conta'), end: endOf(d) });
      out.start += start; out.end += endOf(d); out.accounts++;
    });
    if (!out.accounts) return null;
    out.start = r2(out.start); out.end = r2(out.end);
    return out;
  }

  function updateRespOptions(mo) {
    var resp = {};
    Object.keys(mo.marks).forEach(function (k) { if (mo.marks[k].resp) resp[mo.marks[k].resp] = 1; });
    Object.keys(state.months).forEach(function (m) { var mk = state.months[m].marks || {}; Object.keys(mk).forEach(function (k) { if (mk[k].resp) resp[mk[k].resp] = 1; }); });
    var names = Object.keys(resp).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    $('respList').innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('');
  }

  function render() {
    var months = Object.keys(state.months).sort().reverse();
    $('monthField').hidden = !months.length;
    $('monthSelect').innerHTML = months.map(function (m) {
      return '<option value="' + m + '"' + (m === state.lastMonth ? ' selected' : '') + '>' + esc(monthLabel(m)) + '</option>';
    }).join('');
    var mo = current();
    $('workArea').hidden = !mo;
    if (!mo) return;


    // Dias
    var days = [], count = {};
    mo.rows.forEach(function (r) { if (r.saldo) return; if (!count[r.day]) { days.push(r.day); count[r.day] = 0; } count[r.day]++; });
    if (state.ui.day && !count[state.ui.day]) state.ui.day = '';
    $('daySelect').innerHTML = '<option value="">Todos os dias</option>' + days.map(function (d) {
      return '<option value="' + d + '"' + (d === state.ui.day ? ' selected' : '') + '>' + d + ' · ' + count[d] + '</option>';
    }).join('');

    // Somas
    var opts = Core.sumOptions(mo.columns, mo.rows);
    if (!Array.isArray(mo.sum)) mo.sum = Core.defaultSumKeys(mo.columns, mo.rows);
    var sel = mo.sum;
    $('sumOptions').innerHTML = opts.map(function (o) {
      var on = sel.indexOf(o.key) !== -1;
      return '<button type="button" class="ex-chip' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" data-key="' + esc(o.key) + '">' + esc(o.label) + '</button>';
    }).join('');
    var monthBase = sumBase(mo.rows), visBase = sumBase(visibleRows(mo));
    var filtered = !!(state.ui.day || state.ui.type || activeCf().length || $('search').value.trim());
    var chosen = opts.filter(function (o) { return sel.indexOf(o.key) !== -1; });
    var scope = state.ui.day ? 'dia ' + state.ui.day : monthLabel(state.lastMonth);
    var cards = '';
    var bal = balances(mo, state.ui.day || '');
    if (bal) {
      var mmTxt = state.lastMonth ? '/' + state.lastMonth.slice(5) : '';
      var dd = function (n) { return String(n).padStart(2, '0') + mmTxt; };
      var check = bal.ok
        ? '<small class="is-ok">Confere com o saldo do banco</small>'
        : '<small class="is-warn">Não fecha ' + bal.gaps.map(function (g) { return 'de ' + dd(g.from) + ' a ' + dd(g.to) + ' (' + brl.format(g.diff) + ')'; }).join('; ') + ': falta lançamento ou arquivo</small>';
      cards += '<div class="ex-total ex-balance"><span>Saldo inicial</span><strong>' + brl.format(bal.start) + '</strong><small>Início ' + (state.ui.day ? 'do dia ' + state.ui.day : 'do período') + (bal.accounts > 1 ? ' · ' + bal.accounts + ' contas' : '') + '</small></div>';
      var perAcct = bal.parts.length > 1 ? bal.parts.map(function (x) { return '<small class="ex-acct">' + esc(x.label) + ': ' + brl.format(x.end) + '</small>'; }).join('') : '';
      cards += '<div class="ex-total ex-balance"><span>Saldo final</span><strong class="' + (bal.end < 0 ? 'is-neg' : '') + '">' + brl.format(bal.end) + '</strong><small>Fim ' + (state.ui.day ? 'do dia ' + state.ui.day : 'do período') + '</small>' + perAcct + check + '</div>';
    }
    cards += chosen.map(function (o) {
      var total = Core.applySum(o, visBase);
      return '<div class="ex-total"><span>' + esc(o.label) + '</span><strong class="' + (total < 0 ? 'is-neg' : '') + '">' + brl.format(total) + '</strong>' +
        '<small>' + (filtered ? 'Seleção · mês: ' + brl.format(Core.applySum(o, monthBase)) : esc(scope)) + '</small></div>';
    }).join('');
    $('sumTotals').innerHTML = cards || '<div class="ex-total ex-total-empty"><span>Nenhum campo selecionado</span></div>';

    // Contagem de status
    var nP = 0, nA = 0;
    mo.rows.forEach(function (r) { var s = (mo.marks[r.id] || {}).status; if (s === 'Pendente') nP++; else if (s === 'Em análise') nA++; });
    $('statusCounts').innerHTML = '<span class="ex-badge is-pend">' + nP + ' pendente' + (nP === 1 ? '' : 's') + '</span><span class="ex-badge is-ana">' + nA + ' em análise</span>';

    updateRespOptions(mo);
    $('typeFilter').value = state.ui.type || '';
    $('clearCf').hidden = !(activeCf().length || (state.ui.sort && state.ui.sort.key));

    // Tabela
    var cols = mo.columns;
    var srcKeys = Object.keys(mo.sources || {});
    var multi = srcKeys.length > 1;
    var defs = tableCols(mo), cf = colFilters(), so = state.ui.sort || {};
    $('thead').innerHTML = '<tr>' + defs.map(function (d) {
      var on = Array.isArray(cf[d.key]), sorted = so.key === d.key;
      var icon = sorted ? (so.dir > 0 ? '↑' : '↓') : '';
      return '<th class="' + (d.kind === 'num' ? 'num' : '') + '"><div class="th-in"><span>' + esc(d.label) + '</span>' +
        '<button type="button" class="ex-fbtn' + (on ? ' is-filter' : '') + (sorted ? ' is-sort' : '') + '" data-key="' + esc(d.key) + '" aria-haspopup="dialog" aria-label="Filtrar e ordenar ' + esc(d.label) + '" title="Filtrar e ordenar">' +
        (icon ? '<b>' + icon + '</b>' : '') + (on ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.5 5.5V13l-3-1.5v-3Z" fill="currentColor"/></svg>' : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>') +
        '</button></div></th>';
    }).join('') + '</tr>';
    var rows = sortRows(visibleRows(mo), defs);
    $('tbody').innerHTML = rows.map(function (r) {
      var mk = mo.marks[r.id] || {};
      var cls = mk.status === 'Pendente' ? 'st-pend' : mk.status === 'Em análise' ? 'st-ana' : '';
      return '<tr data-id="' + r.id + '" class="' + cls + (r.saldo ? ' is-saldo' : '') + '">' + defs.map(function (d) {
        if (d.key === 'date') return '<td class="date">' + esc(r.day) + '</td>';
        if (d.key === 'src') return '<td class="src">' + esc(srcLabelOf(mo, r)) + '</td>';
        if (d.key === 'hist') return '<td class="desc">' + esc(r.hist || r.desc) + (r.party ? '' : (r.extra ? '<small>' + esc(r.extra) + '</small>' : '')) + '</td>';
        if (d.key === 'party') return '<td class="party">' + esc(r.party || '') + (r.party && r.extra ? '<small>' + esc(r.extra) + '</small>' : '') + '</td>';
        if (d.key === 'desc') return '<td class="desc">' + esc(r.desc) + (r.extra ? '<small>' + esc(r.extra) + '</small>' : '') + '</td>';
        if (d.kind === 'num') { var v = r.values[d.col]; return '<td class="num' + (v < 0 ? ' is-neg' : '') + '">' + (typeof v === 'number' ? brl.format(v) : '') + '</td>'; }
        if (d.key === 'status') return '<td><select class="ex-status" aria-label="Status"><option value="">—</option>' + STATUSES.map(function (st) {
          return '<option' + (mk.status === st ? ' selected' : '') + '>' + st + '</option>'; }).join('') + '</select></td>';
        return '<td><input class="ex-resp" type="text" list="respList" maxlength="60" value="' + esc(mk.resp || '') + '" aria-label="Responsável"></td>';
      }).join('') + '</tr>';
    }).join('');
    $('emptyRows').hidden = rows.length > 0;
    var footBase = sumBase(rows);
    var onlyDay = !(state.ui.type || activeCf().length || $('search').value.trim());
    var lead = defs.filter(function (d) { return d.kind !== 'num' && d.key !== 'status' && d.key !== 'resp'; }).length;
    var footBal = onlyDay ? balances(mo, state.ui.day || '') : null;
    var firstSaldo = true;
    $('tfoot').innerHTML = rows.length ? '<tr><td colspan="' + lead + '">Total da seleção' + (footBal ? '<small>Saldo: fim ' + (state.ui.day ? 'do dia ' + esc(state.ui.day) : 'do período') + '</small>' : '') + '</td>' + cols.map(function (c) {
      var t = null;
      if (c.saldo) { if (footBal && firstSaldo) { t = footBal.end; firstSaldo = false; } }
      else t = Core.applySum({ col: c.id, mode: 'all' }, footBase);
      return '<td class="num' + (t < 0 ? ' is-neg' : '') + '">' + (t === null ? '' : brl.format(t)) + '</td>';
    }).join('') + '<td colspan="2"></td></tr>' : '';
    $('rowCount').textContent = rows.length + ' de ' + mo.rows.filter(function (r) { return !r.saldo; }).length + ' lançamentos · ' + (multi ? srcKeys.length + ' arquivos' : mo.fileName);
  }

  /* ---- Janela do filtro de coluna ---- */
  var pop = null, popKey = null, popBtn = null;
  function closePop() { if (pop) { pop.hidden = true; } if (popBtn) popBtn.setAttribute('aria-expanded', 'false'); popKey = null; popBtn = null; }
  function openPop(key, btn) {
    var mo = current(); if (!mo) return;
    if (popKey === key) { closePop(); return; }
    var d = tableCols(mo).filter(function (x) { return x.key === key; })[0]; if (!d) return;
    if (!pop) {
      pop = document.createElement('div'); pop.className = 'ex-pop'; pop.id = 'colPop'; pop.setAttribute('role', 'dialog');
      document.body.appendChild(pop);
      pop.addEventListener('click', onPopClick);
      pop.addEventListener('input', onPopInput);
      pop.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var b = popBtn; closePop(); if (b) b.focus(); } if (e.key === 'Enter' && e.target.classList.contains('pop-search')) { e.preventDefault(); applyPop(); } });
    }
    popKey = key; popBtn = btn; btn.setAttribute('aria-expanded', 'true');
    // Valores possíveis considerando os outros filtros (como na planilha).
    var base = visibleRows(mo, key).filter(function (r) { return !r.saldo; });
    var count = {}, vals = [];
    base.forEach(function (r) { var t = d.text(r); if (!count[t]) { count[t] = 0; vals.push({ t: t, s: d.sortVal(r) }); } count[t]++; });
    vals.sort(function (a, b) {
      if (a.s === null) return 1; if (b.s === null) return -1;
      return typeof a.s === 'number' ? a.s - b.s : String(a.s).localeCompare(String(b.s), 'pt-BR');
    });
    var cur = colFilters()[key];
    var labels = d.kind === 'num' ? ['Menor para maior', 'Maior para menor'] : d.kind === 'date' ? ['Mais antiga primeiro', 'Mais recente primeiro'] : ['Ordenar de A a Z', 'Ordenar de Z a A'];
    var so = state.ui.sort || {};
    pop.innerHTML = '<div class="pop-title">' + esc(d.label) + '</div>' +
      '<div class="pop-sort"><button type="button" data-sort="1" class="' + (so.key === key && so.dir > 0 ? 'is-on' : '') + '">↑ ' + labels[0] + '</button>' +
      '<button type="button" data-sort="-1" class="' + (so.key === key && so.dir < 0 ? 'is-on' : '') + '">↓ ' + labels[1] + '</button></div>' +
      '<input type="search" class="pop-search" placeholder="Pesquisar" aria-label="Pesquisar valores">' +
      '<label class="pop-all"><input type="checkbox"' + (!cur ? ' checked' : '') + '> (Selecionar tudo)</label>' +
      '<div class="pop-list">' + vals.slice(0, 1500).map(function (v) {
        var on = !cur || cur.indexOf(v.t) !== -1;
        return '<label data-t="' + esc(v.t.toLowerCase()) + '"><input type="checkbox" value="' + esc(v.t) + '"' + (on ? ' checked' : '') + '><span>' + esc(v.t) + '</span><em>' + count[v.t] + '</em></label>';
      }).join('') + (vals.length ? '' : '<p class="pop-empty">Nenhum valor</p>') + '</div>' +
      '<div class="pop-actions"><button type="button" class="pop-clear">Limpar filtro</button><button type="button" class="pop-ok">OK</button></div>';
    pop.hidden = false;
    // Abre embaixo do botão; se não couber, abre em cima; sempre dentro da tela.
    var rc = btn.getBoundingClientRect(), w = pop.offsetWidth || 280, h = pop.offsetHeight, vh = window.innerHeight;
    pop.style.left = Math.max(8, Math.min(rc.right - w, window.innerWidth - w - 8)) + 'px';
    var top = rc.bottom + 6;
    if (top + h > vh - 8) top = rc.top - h - 6 >= 8 ? rc.top - h - 6 : Math.max(8, vh - h - 8);
    pop.style.top = top + 'px';
    syncAll();
    pop.querySelector('.pop-search').focus();
  }
  function popBoxes(onlyVisible) {
    return Array.prototype.filter.call(pop.querySelectorAll('.pop-list input[type=checkbox]'), function (c) { return !onlyVisible || !c.parentNode.hidden; });
  }
  function syncAll() {
    var vis = popBoxes(true), all = pop.querySelector('.pop-all input');
    all.checked = vis.length > 0 && vis.every(function (c) { return c.checked; });
    all.indeterminate = !all.checked && vis.some(function (c) { return c.checked; });
  }
  function onPopInput(e) {
    if (e.target.classList.contains('pop-search')) {
      var q = e.target.value.trim().toLowerCase();
      Array.prototype.forEach.call(pop.querySelectorAll('.pop-list label'), function (l) { l.hidden = q && l.getAttribute('data-t').indexOf(q) === -1; });
      // Na planilha, ao pesquisar, ficam marcados só os itens encontrados.
      if (q) popBoxes(false).forEach(function (c) { c.checked = !c.parentNode.hidden; });
      syncAll();
    }
  }
  function onPopClick(e) {
    var t = e.target;
    if (t.closest('[data-sort]')) {
      var dir = Number(t.closest('[data-sort]').getAttribute('data-sort'));
      var so = state.ui.sort || {};
      state.ui.sort = (so.key === popKey && so.dir === dir) ? null : { key: popKey, dir: dir };
      save(); closePop(); render(); return;
    }
    if (t.closest('.pop-all') && t.tagName === 'INPUT') { popBoxes(true).forEach(function (c) { c.checked = t.checked; }); syncAll(); return; }
    if (t.tagName === 'INPUT' && t.closest('.pop-list')) { syncAll(); return; }
    if (t.closest('.pop-clear')) { delete colFilters()[popKey]; save(); closePop(); render(); return; }
    if (t.closest('.pop-ok')) applyPop();
  }
  function applyPop() {
    var boxes = popBoxes(false), searching = pop.querySelector('.pop-search').value.trim();
    var chosen = boxes.filter(function (c) { return c.checked && (!searching || !c.parentNode.hidden); }).map(function (c) { return c.value; });
    if (!searching && chosen.length === boxes.length) delete colFilters()[popKey];
    else colFilters()[popKey] = chosen;
    save(); closePop(); render();
  }
  document.addEventListener('mousedown', function (e) { if (pop && !pop.hidden && !pop.contains(e.target) && !e.target.closest('.ex-fbtn')) closePop(); });
  window.addEventListener('resize', closePop);
  document.addEventListener('scroll', function (e) { if (pop && !pop.hidden && !pop.contains(e.target)) closePop(); }, true);

  function setMark(id, patch) {
    var mo = current(); if (!mo) return;
    var mk = mo.marks[id] || {};
    Object.keys(patch).forEach(function (k) { mk[k] = patch[k]; });
    mk.at = new Date().toISOString();
    if (!mk.status && !mk.resp) delete mo.marks[id]; else mo.marks[id] = mk;
    save();
  }

  /* ---------------- Eventos ---------------- */
  $('pdfFile').addEventListener('change', function (e) { handleFile(e.target.files && e.target.files[0]); });
  $('previewMonth').addEventListener('input', updateSaveLabel);
  $('saveImport').addEventListener('click', commitImport);
  $('cancelImport').addEventListener('click', function () { pending = null; $('preview').hidden = true; $('fileName').textContent = 'Nenhum arquivo selecionado'; });
  $('monthSelect').addEventListener('change', function (e) { state.lastMonth = e.target.value; state.ui.day = ''; message(''); save(); render(); });
  $('daySelect').addEventListener('change', function (e) { state.ui.day = e.target.value; save(); render(); });
  $('typeFilter').addEventListener('change', function (e) { state.ui.type = e.target.value; save(); render(); });
  $('clearCf').addEventListener('click', function () { state.ui.cf = {}; state.ui.sort = null; save(); closePop(); render(); });
  $('thead').addEventListener('click', function (e) { var b = e.target.closest('.ex-fbtn'); if (b) openPop(b.getAttribute('data-key'), b); });
  var searchTimer = null;
  $('search').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(render, 200); });
  $('sumOptions').addEventListener('click', function (e) {
    var b = e.target.closest('.ex-chip'); if (!b) return;
    var mo = current(); if (!mo) return;
    var k = b.getAttribute('data-key'), sel = mo.sum || [];
    mo.sum = sel.indexOf(k) === -1 ? sel.concat([k]) : sel.filter(function (x) { return x !== k; });
    save(); render();
  });
  $('tbody').addEventListener('change', function (e) {
    var tr = e.target.closest('tr[data-id]'); if (!tr) return;
    if (e.target.classList.contains('ex-status')) {
      setMark(tr.getAttribute('data-id'), { status: e.target.value });
      tr.className = (e.target.value === 'Pendente' ? 'st-pend' : e.target.value === 'Em análise' ? 'st-ana' : '') + (tr.classList.contains('is-saldo') ? ' is-saldo' : '');
      var mo = current(), nP = 0, nA = 0;
      mo.rows.forEach(function (r) { var s = (mo.marks[r.id] || {}).status; if (s === 'Pendente') nP++; else if (s === 'Em análise') nA++; });
      $('statusCounts').innerHTML = '<span class="ex-badge is-pend">' + nP + ' pendente' + (nP === 1 ? '' : 's') + '</span><span class="ex-badge is-ana">' + nA + ' em análise</span>';
      if (Array.isArray(colFilters().status) || (state.ui.sort && state.ui.sort.key === 'status')) render();
    } else if (e.target.classList.contains('ex-resp')) {
      setMark(tr.getAttribute('data-id'), { resp: e.target.value.trim() });
      updateRespOptions(current());
    }
  });
  var respTimer = null;
  $('tbody').addEventListener('input', function (e) {
    if (!e.target.classList.contains('ex-resp')) return;
    var tr = e.target.closest('tr[data-id]'), val = e.target.value;
    clearTimeout(respTimer);
    respTimer = setTimeout(function () { setMark(tr.getAttribute('data-id'), { resp: val.trim() }); }, 500);
  });
  $('deleteMonth').addEventListener('click', function () {
    var m = state.lastMonth; if (!m) return;
    if (!window.confirm('Excluir ' + monthLabel(m) + ' desta empresa, com os status e responsáveis marcados?')) return;
    delete state.months[m];
    state.lastMonth = Object.keys(state.months).sort().reverse()[0] || '';
    save(); render();
  });

  window.ExtratoApp = {
    fileKind: fileKind, readAny: readAny, monthLabel: monthLabel,
    importInto: function (co, m, fileName, parsed, src, label, opts) {
      var st = co === company ? state : loadFor(co);
      var res = mergeImport(st, m, fileName, parsed, src, label, opts);
      if (res.duplicate || res.conflict) return res;
      if (co === company && !state.lastMonth) state.lastMonth = m;
      saveFor(co, st);
      if (co === company) render();
      return res;
    },
    reload: function () { state = load(); render(); },
    company: function () { return company; }
  };

  render();
})();
