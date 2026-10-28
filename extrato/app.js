/* Extrato do mês · tela (v1.0)
   Dados salvos por empresa em localStorage: cf:extrato:<empresa>
   { months: { 'AAAA-MM': { fileName, importedAt, columns, rows, marks: { idLançamento: { status, resp, at } } } },
     lastMonth, prefs: { sum: [chaves], ignoreSaldo }, ui: { day } } */
(function () {
  'use strict';

  var Shell = window.CentralShell, Core = window.ExtratoCore;
  var $ = function (id) { return document.getElementById(id); };
  var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var STATUSES = ['Pendente', 'Em análise'];

  var company = Shell ? Shell.company() : null;
  var KEY = company ? 'cf:extrato:' + company : null;
  var state = load();
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
      return { id: r.id + tag, date: r.dd + '/' + r.mm + '/' + (r.yyyy || yyyy), day: r.dd + '/' + r.mm, desc: r.desc, values: values, saldo: r.saldo, src: src };
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
      // Leva status e responsáveis do arquivo antigo para os mesmos lançamentos no novo.
      var oldMarks = (old && old.marks) || {}, bySig = {};
      rows.forEach(function (r) { var k = rowSig(r); (bySig[k] = bySig[k] || []).push(r); });
      old.rows.forEach(function (r) {
        if (replaced.indexOf(r.src || '') === -1 || !oldMarks[r.id]) return;
        var list = bySig[rowSig(r)];
        if (list && list.length) { var to = list.shift(); if (!oldMarks[to.id]) oldMarks[to.id] = oldMarks[r.id]; }
        delete oldMarks[r.id];
      });
      old.rows = old.rows.filter(function (r) { return replaced.indexOf(r.src || '') === -1; });
      replaced.forEach(function (k) { if (old.sources) delete old.sources[k]; });
    }

    var others = old ? old.rows.filter(function (r) { return (r.src || '') !== src; }) : [];
    var all = others.concat(rows).map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
      return a.r.day.slice(0, 2) - b.r.day.slice(0, 2) || a.i - b.i;
    }).map(function (x) { return x.r; });
    var marks = (old && old.marks) || {};
    var kept = rows.filter(function (r) { return marks[r.id]; }).length;
    var opts = Core.sumOptions(columns, all);
    var keep = ((old && old.sum) || []).filter(function (k) { return opts.some(function (o) { return o.key === k; }); });
    var sources = (old && old.sources) || {};
    if (old && !old.sources && others.length) sources[''] = { label: old.fileName, importedAt: old.importedAt };
    sources[src] = { label: label || fileName, fileName: fileName, account: parsed.account || '', importedAt: new Date().toISOString() };
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
      $('previewTitle').textContent = parsed.rows.length + ' lançamentos encontrados';
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
  function visibleRows(mo) {
    var ui = state.ui, day = ui.day || '', st = ui.status || '', tp = ui.type || '', rp = ui.resp || '';
    var q = $('search').value.trim().toLowerCase();
    return mo.rows.filter(function (r) {
      if (day && r.day !== day) return false;
      var mk = mo.marks[r.id] || {};
      if (st === '-' && mk.status) return false;
      if (st && st !== '-' && mk.status !== st) return false;
      if (tp && rowType(r, mo.columns) !== tp) return false;
      if (rp === '-' && mk.resp) return false;
      if (rp && rp !== '-' && (mk.resp || '') !== rp) return false;
      if (q && (r.desc + ' ' + (mk.resp || '') + ' ' + (((mo.sources || {})[r.src || ''] || {}).label || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function sumBase(rows) { return state.prefs.ignoreSaldo === false ? rows : rows.filter(function (r) { return !r.saldo; }); }

  function updateRespOptions(mo) {
    var resp = {};
    Object.keys(mo.marks).forEach(function (k) { if (mo.marks[k].resp) resp[mo.marks[k].resp] = 1; });
    Object.keys(state.months).forEach(function (m) { var mk = state.months[m].marks || {}; Object.keys(mk).forEach(function (k) { if (mk[k].resp) resp[mk[k].resp] = 1; }); });
    var names = Object.keys(resp).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    $('respList').innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('');
    var monthResp = {};
    Object.keys(mo.marks).forEach(function (k) { if (mo.marks[k].resp) monthResp[mo.marks[k].resp] = 1; });
    if (state.ui.resp && state.ui.resp !== '-' && !monthResp[state.ui.resp]) state.ui.resp = '';
    $('respFilter').innerHTML = '<option value="">Todos</option><option value="-"' + (state.ui.resp === '-' ? ' selected' : '') + '>Sem responsável</option>' +
      Object.keys(monthResp).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); }).map(function (n) {
        return '<option value="' + esc(n) + '"' + (n === state.ui.resp ? ' selected' : '') + '>' + esc(n) + '</option>';
      }).join('');
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

    $('ignoreSaldo').checked = state.prefs.ignoreSaldo !== false;

    // Dias
    var days = [], count = {};
    mo.rows.forEach(function (r) { if (!count[r.day]) { days.push(r.day); count[r.day] = 0; } count[r.day]++; });
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
    var filtered = !!(state.ui.day || state.ui.status || state.ui.type || state.ui.resp || $('search').value.trim());
    var chosen = opts.filter(function (o) { return sel.indexOf(o.key) !== -1; });
    $('sumTotals').innerHTML = chosen.length ? chosen.map(function (o) {
      var total = Core.applySum(o, monthBase);
      return '<div class="ex-total"><span>' + esc(o.label) + '</span><strong class="' + (total < 0 ? 'is-neg' : '') + '">' + brl.format(total) + '</strong>' +
        (filtered ? '<small>Seleção: ' + brl.format(Core.applySum(o, visBase)) + '</small>' : '<small>' + esc(monthLabel(state.lastMonth)) + '</small>') + '</div>';
    }).join('') : '<div class="ex-total ex-total-empty"><span>Nenhum campo selecionado</span></div>';

    // Contagem de status
    var nP = 0, nA = 0;
    mo.rows.forEach(function (r) { var s = (mo.marks[r.id] || {}).status; if (s === 'Pendente') nP++; else if (s === 'Em análise') nA++; });
    $('statusCounts').innerHTML = '<span class="ex-badge is-pend">' + nP + ' pendente' + (nP === 1 ? '' : 's') + '</span><span class="ex-badge is-ana">' + nA + ' em análise</span>';

    updateRespOptions(mo);
    $('statusFilter').value = state.ui.status || '';
    $('typeFilter').value = state.ui.type || '';

    // Tabela
    var cols = mo.columns;
    var srcKeys = Object.keys(mo.sources || {});
    var multi = srcKeys.length > 1;
    var srcLabel = function (r) { var x = (mo.sources || {})[r.src || '']; return x ? x.label : ''; };
    $('thead').innerHTML = '<tr><th>Data</th>' + (multi ? '<th>Arquivo</th>' : '') + '<th>Descrição</th>' + cols.map(function (c) { return '<th class="num">' + esc(c.name) + '</th>'; }).join('') + '<th>Status</th><th>Responsável</th></tr>';
    var rows = visibleRows(mo);
    $('tbody').innerHTML = rows.map(function (r) {
      var mk = mo.marks[r.id] || {};
      var cls = mk.status === 'Pendente' ? 'st-pend' : mk.status === 'Em análise' ? 'st-ana' : '';
      return '<tr data-id="' + r.id + '" class="' + cls + (r.saldo ? ' is-saldo' : '') + '"><td class="date">' + esc(r.day) + '</td>' + (multi ? '<td class="src">' + esc(srcLabel(r)) + '</td>' : '') + '<td class="desc">' + esc(r.desc) + '</td>' +
        cols.map(function (c) {
          var v = r.values[c.id];
          return '<td class="num' + (v < 0 ? ' is-neg' : '') + '">' + (typeof v === 'number' ? brl.format(v) : '') + '</td>';
        }).join('') +
        '<td><select class="ex-status" aria-label="Status"><option value="">—</option>' + STATUSES.map(function (s) {
          return '<option' + (mk.status === s ? ' selected' : '') + '>' + s + '</option>';
        }).join('') + '</select></td>' +
        '<td><input class="ex-resp" type="text" list="respList" maxlength="60" value="' + esc(mk.resp || '') + '" aria-label="Responsável"></td></tr>';
    }).join('');
    $('emptyRows').hidden = rows.length > 0;
    var footBase = sumBase(rows);
    $('tfoot').innerHTML = rows.length ? '<tr><td colspan="' + (multi ? 3 : 2) + '">Total da seleção</td>' + cols.map(function (c) {
      var t = c.saldo ? null : Core.applySum({ col: c.id, mode: 'all' }, footBase);
      return '<td class="num' + (t < 0 ? ' is-neg' : '') + '">' + (t === null ? '' : brl.format(t)) + '</td>';
    }).join('') + '<td colspan="2"></td></tr>' : '';
    $('rowCount').textContent = rows.length + ' de ' + mo.rows.length + ' lançamentos · ' + (multi ? srcKeys.length + ' arquivos' : mo.fileName);
  }

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
  $('statusFilter').addEventListener('change', function (e) { state.ui.status = e.target.value; save(); render(); });
  $('typeFilter').addEventListener('change', function (e) { state.ui.type = e.target.value; save(); render(); });
  $('respFilter').addEventListener('change', function (e) { state.ui.resp = e.target.value; save(); render(); });
  var searchTimer = null;
  $('search').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(render, 200); });
  $('ignoreSaldo').addEventListener('change', function (e) { state.prefs.ignoreSaldo = e.target.checked; save(); render(); });
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
      if (state.ui.status) render();
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
