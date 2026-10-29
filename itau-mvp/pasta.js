/* Análise de pagamentos · pasta conectada (v1.0)
   Usa a mesma pasta conectada no Extrato do mês (Chrome/Edge).
   Itaú: saídas (valores negativos) do extrato da empresa escolhida.
   Dealer: arquivo "TOTAIS PAGOS" da pasta (filtrado pela empresa, quando o arquivo tiver a coluna de empresa).
   A conciliação é a mesma da tela (IntelligentReconciler). */
(function () {
  'use strict';

  var Shell = window.CentralShell, Core = window.ExtratoCore;
  var $ = function (id) { return document.getElementById(id); };
  if (!Shell || !Core || !$('autoBox') || !window.MVPAuto) return;

  var company = Shell.company();
  var PREF_KEY = 'cf:pagamentos:' + (company || '');
  var SUPPORTED = typeof window.showDirectoryPicker === 'function';
  var dir = null, granted = false, busy = false;
  var data = null; // { stmtFiles, rows, latestDays, dealer: { file, matrix, empCol, empNames } }

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function prefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {} }
  function mapa() { try { var m = JSON.parse(localStorage.getItem('cf:extrato:mapa') || '{}') || {}; m.arquivos = m.arquivos || {}; return m; } catch (e) { return { arquivos: {} }; } }
  function baseName(n) { return String(n).replace(/\.[^.]+$/, '').replace(/[.\s_-]+$/, '').trim(); }
  function dateKey(d) { var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || ''); return m ? m[3] + m[2] + m[1] : ''; }
  function brl(n) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n || 0); }
  function status(t, kind) { $('autoStatus').textContent = t || ''; $('autoStatus').className = 'auto-status' + (kind ? ' is-' + kind : ''); }

  /* ---------------- Pasta (a mesma do Extrato do mês) ---------------- */
  function idbGet(k) {
    return new Promise(function (res) {
      var r = indexedDB.open('central-financeira', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onerror = function () { res(null); };
      r.onsuccess = function () {
        try { var q = r.result.transaction('kv').objectStore('kv').get(k); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; }
        catch (e) { res(null); }
      };
    });
  }
  function idbSet(k, v) {
    return new Promise(function (res) {
      var r = indexedDB.open('central-financeira', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onerror = function () { res(false); };
      r.onsuccess = function () { var t = r.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = function () { res(true); }; t.onerror = function () { res(false); }; };
    });
  }
  async function walk(h, path, depth, out) {
    for await (var e of h.values()) {
      if (e.name.charAt(0) === '.' || e.name.indexOf('~$') === 0) continue;
      if (e.kind === 'directory') { if (depth < 3) await walk(e, path.concat([e.name]), depth + 1, out); continue; }
      if (/\.(xlsx|xlsm|xls|csv)$/i.test(e.name)) out.push({ name: e.name, path: path.concat([e.name]).join('/'), handle: e });
    }
    return out;
  }

  /* ---------------- Excel ---------------- */
  function fixRange(ws) {
    var R = -1, C = -1;
    Object.keys(ws).forEach(function (k) { if (k.charAt(0) === '!') return; var a = XLSX.utils.decode_cell(k); if (a.r > R) R = a.r; if (a.c > C) C = a.c; });
    if (R >= 0) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: R, c: C } });
  }
  async function readMatrix(file) {
    var wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    var ws = wb.Sheets[wb.SheetNames[0]];
    fixRange(ws);
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  }

  /* ---------------- Quais arquivos são desta empresa ---------------- */
  function isTotais(name) { return /totais?pagos?|totalpago/.test(Shell.slug(baseName(name))); }
  // Extrato: só arquivos com "EXTRATO" no nome; a empresa vem depois da palavra.
  function isExtrato(name) { return Shell.slug(baseName(name)).indexOf('extrato') !== -1; }
  function companyPart(name) {
    return baseName(name).replace(/\bextratos?\b/ig, ' ').replace(/^[\s._-]+|[\s._-]+$/g, '').replace(/\s+/g, ' ').trim();
  }
  function belongsTo(name, co) {
    var part = companyPart(name), key = Shell.slug(part), mp = mapa();
    if (mp.arquivos[key]) return mp.arquivos[key] === co;
    var c = Shell.companyByName(part);
    if (c) return c.id === co;
    var starts = Shell.COMPANIES.filter(function (x) { var k = Shell.slug(x.name); return k.length >= 3 && key.indexOf(k) === 0; })
      .sort(function (a, b) { return Shell.slug(b.name).length - Shell.slug(a.name).length; });
    return !!starts.length && starts[0].id === co;
  }

  async function collect() {
    var list = await walk(dir, [], 0, []);
    var stmts = [], totais = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (isTotais(e.name)) { totais.push(e); continue; }
      if (isExtrato(e.name) && belongsTo(e.name, company)) stmts.push(e);
    }
    // Extratos: lançamentos por conta; cada dia vem do arquivo mais novo daquela conta.
    var parsed = [];
    for (var j = 0; j < stmts.length; j++) {
      var f = await stmts[j].handle.getFile();
      var matrix = await readMatrix(f);
      var p = Core.parseSheet(matrix);
      if (!p.rows.length) continue;
      p.account = Core.findAccount(matrix.slice(0, 15).map(function (r) { return { str: r.join(' ') }; })) || stmts[j].name;
      p.file = stmts[j].name; p.modified = f.lastModified;
      parsed.push(p);
    }
    parsed.sort(function (a, b) { return b.modified - a.modified; });
    var taken = {}, rows = [];
    parsed.forEach(function (p) {
      var days = {};
      p.rows.forEach(function (r) { if (!r.saldo) days[r.date] = 1; });
      Object.keys(days).forEach(function (d) {
        var k = p.account + '|' + d;
        if (taken[k]) return;
        taken[k] = p.file;
        p.rows.forEach(function (r) { if (!r.saldo && r.date === d) rows.push({ r: r, file: p.file }); });
      });
    });
    var latestDays = {};
    if (parsed.length) parsed[0].rows.forEach(function (r) { if (!r.saldo) latestDays[r.date] = 1; });

    // Dealer: TOTAIS PAGOS da empresa (no nome) ou o geral.
    var dealer = null;
    var own = totais.filter(function (e) { return Shell.COMPANIES.some(function (c) { return c.id === company && Shell.slug(e.name).indexOf(Shell.slug(c.name)) !== -1; }); });
    var generic = totais.filter(function (e) { return !Shell.COMPANIES.some(function (c) { return Shell.slug(e.name).indexOf(Shell.slug(c.name)) !== -1; }); });
    var pick = own.concat(generic);
    if (pick.length) {
      var files = await Promise.all(pick.map(function (e) { return e.handle.getFile(); }));
      var best = 0;
      files.forEach(function (fl, i) { if (i < own.length) { if (best >= own.length || fl.lastModified > files[best].lastModified) best = i; } else if (best >= own.length && fl.lastModified > files[best].lastModified) best = i; });
      var dm = await readMatrix(files[best]);
      // Cabeçalho do Dealer: primeira linha com a coluna de pessoa e de valor.
      var hRow = 0;
      for (var r = 0; r < Math.min(dm.length, 30); r++) {
        var hn = dm[r].map(function (x) { return Shell.slug(x); });
        if (hn.some(function (x) { return /titulopessoanome|pessoanome|fornecedor|beneficiario|sacado/.test(x); }) && hn.some(function (x) { return /valor/.test(x); })) { hRow = r; break; }
      }
      dm = dm.slice(hRow);
      var empCol = dm[0].map(function (x) { return Shell.slug(x); }).findIndex(function (x) { return /tituloempresanome|empresanome|^empresa$|razaosocialempresa/.test(x); });
      var empNames = [];
      if (empCol >= 0) {
        var seen = {};
        dm.slice(1).forEach(function (row) { var n = String(row[empCol] || '').trim(); if (n && !seen[n]) { seen[n] = 1; empNames.push(n); } });
      }
      dealer = { file: pick[best].name, matrix: dm, empCol: empCol, empNames: empNames };
    }
    return { stmtFiles: parsed.map(function (p) { return p.file; }), rows: rows, latestDays: Object.keys(latestDays), dealer: dealer };
  }

  // Empresa do TOTAIS PAGOS que corresponde à empresa da Central (ex.: "NASA FRANCE VEICULOS" → France).
  // Filiais do TOTAIS PAGOS que são da empresa (ex.: "NASA VEICULOS - SLMB", "- ANPS", "- ITB" → Veículos;
  // "NASA FRANCE VEICULOS" → France, pelo nome que aparece primeiro).
  function ownEmpNames(names) {
    return names.filter(function (n) {
      var k = Shell.slug(n), best = null, at = 1e9;
      Shell.COMPANIES.forEach(function (c) { var s = Shell.slug(c.name), i = k.indexOf(s); if (s.length >= 3 && i >= 0 && i < at) { at = i; best = c.id; } });
      return best === company;
    });
  }
  function empFilter(d, p) {
    if (!d || d.empCol < 0) return null;
    if (p.emp === '__all') return null;
    if (p.emp && p.emp !== '__co' && d.empNames.indexOf(p.emp) !== -1) return [p.emp];
    var own = ownEmpNames(d.empNames);
    return own.length ? own : null;
  }

  /* ---------------- Montagem e análise ---------------- */
  function dealerDays() {
    var d = data.dealer; if (!d) return [];
    var rows = dealerRowsForCompany();
    var days = {};
    rows.forEach(function (r) { var k = r.movementDate || r.cashDate || r.date; if (k) days[k] = 1; });
    return Object.keys(days);
  }
  function selectedRows() {
    var p = prefs(), mode = p.days || 'dealer';
    var all = data.rows.filter(function (x) { return x.r.values && Object.keys(x.r.values).some(function (k) { return x.r.values[k] < 0; }); });
    if (mode === 'dealer') {
      var dd = dealerDays();
      var inDays = all.filter(function (x) { return dd.indexOf(x.r.date) !== -1; });
      if (inDays.length) return inDays;
      mode = 'latest';
    }
    if (mode === 'all') return all;
    if (mode === 'latest') return all.filter(function (x) { return data.latestDays.indexOf(x.r.date) !== -1; });
    return all.filter(function (x) { return x.r.date === mode; });
  }
  function toItau(list) {
    return list.map(function (x, n) {
      var r = x.r, v = 0;
      Object.keys(r.values).forEach(function (k) { if (r.values[k] < 0) v = r.values[k]; });
      var name = r.party || r.hist || r.desc;
      var cols = [r.date, r.hist || r.desc, r.origin || '', r.party || '', r.taxId || '', String(v).replace('.', ',')];
      return { id: 'P' + (n + 1), name: name, payee: name, value: Math.round(Math.abs(v) * 100) / 100, date: r.date, history: r.hist || r.desc, account: r.origin || '',
        taxId: String(r.taxId || '').replace(/\D/g, ''), document: String(r.taxId || '').replace(/\D/g, ''), bankName: name,
        rawText: cols.join(' | '), originalColumns: cols, original: cols.join(' | '), signedValue: v, sourceFile: x.file };
    });
  }
  function dealerRowsForCompany() {
    var d = data.dealer; if (!d) return [];
    var m = d.matrix, only = empFilter(d, prefs());
    if (only) m = [m[0]].concat(m.slice(1).filter(function (row) { return only.indexOf(String(row[d.empCol] || '').trim()) !== -1; }));
    return window.MVPAuto.mapDealer(m);
  }
  function toDealer(itau) {
    var d = data.dealer; if (!d) return [];
    var rows = dealerRowsForCompany();
    // Só os títulos do período do extrato (até 3 dias depois, para pagamentos compensados depois).
    var keys = itau.map(function (x) { return dateKey(x.date); }).filter(Boolean).sort();
    if (!keys.length) return rows;
    var lo = keys[0], hiD = keys[keys.length - 1];
    var hiDate = new Date(Number(hiD.slice(0, 4)), Number(hiD.slice(4, 6)) - 1, Number(hiD.slice(6)) + 3);
    var hi = String(hiDate.getFullYear()) + String(hiDate.getMonth() + 1).padStart(2, '0') + String(hiDate.getDate()).padStart(2, '0');
    var inside = rows.filter(function (r) { var k = dateKey(r.movementDate || r.cashDate || r.date); return !k || (k >= lo && k <= hi); });
    return inside.length ? inside : rows;
  }

  function renderBox() {
    $('autoConnect').hidden = !SUPPORTED || !!dir;
    $('autoAllow').hidden = !(dir && !granted);
    $('autoReload').hidden = !(dir && granted);
    $('autoBody').hidden = !data;
    if (!SUPPORTED) { status('Pasta automática disponível no Chrome e no Edge.'); return; }
    if (!data) return;
    var p = prefs();
    var days = {};
    data.rows.forEach(function (x) { if (Object.keys(x.r.values).some(function (k) { return x.r.values[k] < 0; })) days[x.r.date] = (days[x.r.date] || 0) + 1; });
    var dk = Object.keys(days).sort(function (a, b) { return dateKey(a) < dateKey(b) ? -1 : 1; });
    var latest = data.latestDays.slice().sort(function (a, b) { return dateKey(a) < dateKey(b) ? -1 : 1; });
    var latestLabel = latest.length ? (latest[0] === latest[latest.length - 1] ? latest[0] : latest[0].slice(0, 5) + ' a ' + latest[latest.length - 1].slice(0, 5)) : '—';
    var dd = data.dealer ? dealerDays().sort(function (a, b) { return dateKey(a) < dateKey(b) ? -1 : 1; }) : [];
    var ddLabel = dd.length ? (dd.length === 1 ? dd[0].slice(0, 5) : dd[0].slice(0, 5) + ' a ' + dd[dd.length - 1].slice(0, 5)) : '';
    $('autoDays').innerHTML = (dd.length ? '<option value="dealer">Dias do TOTAIS PAGOS (' + esc(ddLabel) + ')</option>' : '') +
      '<option value="latest">Último extrato (' + esc(latestLabel) + ')</option><option value="all">Todos os dias da pasta</option>' +
      dk.map(function (d) { return '<option value="' + d + '">' + d + ' · ' + days[d] + ' saídas</option>'; }).join('');
    var dv = p.days || 'dealer';
    $('autoDays').value = (dv === 'dealer' && dd.length) || dv === 'all' || dv === 'latest' || days[dv] ? dv : (dd.length ? 'dealer' : 'latest');
    $('autoStmt').textContent = data.stmtFiles.length ? data.stmtFiles.join(' · ') : 'Nenhum extrato de ' + Shell.companyName(company) + ' na pasta';
    $('autoDealer').textContent = data.dealer ? data.dealer.file : 'Arquivo TOTAIS PAGOS não encontrado';
    var d = data.dealer;
    $('autoEmpWrap').hidden = !(d && d.empCol >= 0 && d.empNames.length > 1);
    if (d && d.empCol >= 0) {
      var own = ownEmpNames(d.empNames), sel = p.emp || '__co';
      if (sel !== '__co' && sel !== '__all' && d.empNames.indexOf(sel) === -1) sel = '__co';
      $('autoEmp').innerHTML =
        (own.length ? '<option value="__co">' + esc(Shell.companyName(company)) + ' · ' + own.length + (own.length === 1 ? ' filial' : ' filiais') + '</option>' : '') +
        '<option value="__all">Todas do arquivo</option>' +
        d.empNames.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
      $('autoEmp').value = sel === '__co' && !own.length ? '__all' : sel;
    }
  }

  async function run(analyze) {
    if (!dir || !granted || busy || !company) return;
    busy = true;
    status('Lendo a pasta…');
    try {
      data = await collect();
      renderBox();
      var itau = toItau(selectedRows()), dealer = toDealer(itau);
      window.MVPAuto.load(itau, dealer, { itau: data.stmtFiles.join(', '), dealer: data.dealer ? data.dealer.file : '' });
      if (!data.stmtFiles.length) status('Nenhum extrato de ' + Shell.companyName(company) + ' na pasta.', 'error');
      else if (!data.dealer) status('Arquivo TOTAIS PAGOS não encontrado na pasta.', 'error');
      else if (!itau.length) status('Nenhuma saída no extrato para os dias escolhidos.', 'error');
      else {
        status(itau.length + ' saídas · ' + brl(itau.reduce(function (s, x) { return s + x.value; }, 0)) + ' × ' + dealer.length + ' títulos · ' + brl(dealer.reduce(function (s, x) { return s + x.value; }, 0)));
        if (analyze !== false) await window.MVPAuto.analyze();
      }
    } catch (err) {
      status('Não foi possível ler a pasta: ' + (err && err.message ? err.message : 'erro'), 'error');
    }
    busy = false;
  }

  $('autoConnect').addEventListener('click', async function () {
    try {
      dir = await window.showDirectoryPicker({ id: 'cf-extratos', mode: 'read', startIn: 'desktop' });
      granted = true; await idbSet('extratos-dir', dir); renderBox(); run();
    } catch (e) { if (!e || e.name !== 'AbortError') status('Não foi possível conectar a pasta.', 'error'); }
  });
  $('autoAllow').addEventListener('click', async function () {
    try { granted = (await dir.requestPermission({ mode: 'read' })) === 'granted'; } catch (e) { granted = false; }
    renderBox(); if (granted) run();
  });
  $('autoReload').addEventListener('click', function () { run(); });
  $('autoDays').addEventListener('change', function (e) { var p = prefs(); p.days = e.target.value; savePrefs(p); run(); });
  $('autoEmp').addEventListener('change', function (e) { var p = prefs(); p.emp = e.target.value; savePrefs(p); run(); });

  async function init() {
    if (!SUPPORTED || !company) { renderBox(); return; }
    var h = await idbGet('extratos-dir');
    if (h && typeof h.queryPermission === 'function') {
      dir = h;
      try { granted = (await h.queryPermission({ mode: 'read' })) === 'granted'; } catch (e) { granted = false; }
    }
    renderBox();
    if (dir && granted) run();
  }
  window.PagamentosPasta = { _setDir: function (h) { dir = h; granted = true; renderBox(); return run(); }, run: run };
  init();
})();
