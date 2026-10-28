/* Extrato do mês · pasta conectada (v1.0)
   Chrome / Edge: a pessoa escolhe a pasta uma vez; a Central guarda o acesso (IndexedDB)
   e lê os extratos (PDF e Excel) ao abrir a tela e a cada 2 minutos enquanto ela estiver aberta.
   Empresa: conta lembrada → nome do arquivo → nome da subpasta. Mês: datas do próprio extrato. */
(function () {
  'use strict';

  var Shell = window.CentralShell, App = window.ExtratoApp;
  var $ = function (id) { return document.getElementById(id); };
  if (!Shell || !App || !$('folderBox')) return;

  var SUPPORTED = typeof window.showDirectoryPicker === 'function';
  var INDEX_KEY = 'cf:extrato:pasta';
  var MAP_KEY = 'cf:extrato:mapa';
  var POLL_MS = 120000;
  // Quando a leitura dos arquivos melhora, a pasta inteira é lida de novo uma vez.
  var READER_VERSION = '1.5';

  var dir = null, granted = false, scanning = false, timer = null;
  var handles = {};   // caminho → FileSystemFileHandle (nesta sessão)
  var parsedMem = {}; // caminho → extrato lido aguardando empresa/mês
  var patches = [];   // arquivos substituídos por uma versão mais completa
  function applyPatches(idx) {
    patches.forEach(function (x) { if (idx.files[x.path]) { idx.files[x.path].status = 'duplicado'; idx.files[x.path].msg = x.msg; } });
    patches = [];
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getJSON(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v || d; } catch (e) { return d; } }
  function setJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function index() { var x = getJSON(INDEX_KEY, null); if (!x || !x.files) x = { files: {}, lastScan: '', folderName: '' }; return x; }
  function mapa() { var x = getJSON(MAP_KEY, null); if (!x) x = {}; x.contas = x.contas || {}; x.arquivos = x.arquivos || {}; return x; }
  function ago(iso) {
    if (!iso) return '';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'agora';
    if (s < 3600) return 'há ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'há ' + Math.floor(s / 3600) + ' h';
    return new Date(iso).toLocaleDateString('pt-BR');
  }
  function baseName(name) { return String(name).replace(/\.[^.]+$/, '').replace(/[.\s_-]+$/, '').trim(); }

  /* ---------------- IndexedDB (guarda o acesso à pasta) ---------------- */
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('central-financeira', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet(k) {
    return idb().then(function (db) {
      return new Promise(function (res) { var q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; });
    }).catch(function () { return null; });
  }
  function idbSet(k, v) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var t = db.transaction('kv', 'readwrite');
        if (v === null) t.objectStore('kv').delete(k); else t.objectStore('kv').put(v, k);
        t.oncomplete = function () { res(true); }; t.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
  }

  /* ---------------- Leitura da pasta ---------------- */
  async function walk(handle, path, depth, out) {
    for await (var entry of handle.values()) {
      var name = entry.name;
      if (name.charAt(0) === '.' || name.indexOf('~$') === 0) continue;
      if (entry.kind === 'directory') { if (depth < 5) await walk(entry, path.concat([name]), depth + 1, out); continue; }
      if (!App.fileKind(name)) continue;
      out.push({ path: path.concat([name]).join('/'), name: name, folders: path, handle: entry });
      if (out.length > 3000) break;
    }
    return out;
  }

  function identify(entry, parsed) {
    var mp = mapa();
    if (parsed && parsed.account && mp.contas[parsed.account] && Shell.companyById(mp.contas[parsed.account])) return { company: mp.contas[parsed.account], by: 'conta' };
    var base = baseName(entry.name), key = Shell.slug(base);
    if (mp.arquivos[key] && Shell.companyById(mp.arquivos[key])) return { company: mp.arquivos[key], by: 'arquivo' };
    var c = Shell.companyByName(base);
    if (c) return { company: c.id, by: 'arquivo' };
    // "VEICULOS OUTUBRO 2026" → Veículos (o nome da empresa no início do arquivo).
    var starts = Shell.COMPANIES.filter(function (co) { var k = Shell.slug(co.name); return k.length >= 3 && key.indexOf(k) === 0; })
      .sort(function (a, b) { return Shell.slug(b.name).length - Shell.slug(a.name).length; });
    if (starts.length) return { company: starts[0].id, by: 'arquivo' };
    for (var i = entry.folders.length - 1; i >= 0; i--) {
      var f = Shell.companyByName(entry.folders[i]);
      if (f) return { company: f.id, by: 'pasta' };
    }
    return { company: null, suggestion: base };
  }

  async function processEntry(entry, file, idx) {
    var sig = file.size + ':' + file.lastModified;
    var rec = { sig: sig, label: entry.path, at: new Date().toISOString() };
    var parsed;
    try { parsed = await App.readAny(file); }
    catch (err) { rec.status = 'erro'; rec.msg = err && err.message ? err.message : 'Não foi possível ler.'; idx.files[entry.path] = rec; return; }
    if (!parsed.rows || !parsed.rows.length) { rec.status = 'ignorado'; rec.msg = 'Sem lançamentos de extrato'; idx.files[entry.path] = rec; return; }
    var who = identify(entry, parsed);
    var parts = splitByMonth(parsed);
    rec.month = parts.length ? parts.map(function (x) { return x.month; }).join(',') : (parsed.period || '');
    rec.account = parsed.account || '';
    rec.suggestion = who.suggestion || '';
    if (!who.company || !rec.month) {
      rec.status = 'aguardando';
      rec.msg = !who.company ? 'Empresa não identificada' : 'Mês não identificado';
      rec.company = who.company || '';
      parsedMem[entry.path] = parsed;
      idx.files[entry.path] = rec;
      return;
    }
    doImport(entry.path, entry.name, parsed, who.company, rec.month, rec);
    idx.files[entry.path] = rec;
  }

  // Lançamentos de meses diferentes no mesmo arquivo vão cada um para o seu mês.
  function splitByMonth(parsed) {
    var year = (parsed.period || '').slice(0, 4), groups = {}, order = [];
    parsed.rows.forEach(function (r) {
      var y = r.yyyy || year;
      if (!y) return;
      var k = y + '-' + r.mm;
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(r);
    });
    // Mês só com linha de saldo (ex.: "SALDO ANTERIOR" do último dia do mês anterior) não vira mês novo.
    order = order.filter(function (k) { return groups[k].some(function (r) { return !r.saldo; }); });
    return order.sort().map(function (k) {
      return { month: k, parsed: { columns: parsed.columns, rows: groups[k], period: k, account: parsed.account } };
    });
  }

  function doImport(path, name, parsed, company, month, rec, force) {
    var parts = month && month.indexOf(',') === -1 && parsed.period !== month
      ? [{ month: month, parsed: parsed }]
      : splitByMonth(parsed);
    if (!parts.length) parts = [{ month: month, parsed: parsed }];
    var res = { kept: 0 }, firstRes = null;
    for (var i = 0; i < parts.length; i++) {
      var r = App.importInto(company, parts[i].month, name, parts[i].parsed, 'pasta:' + path, name, { force: !!force });
      if (!firstRes) firstRes = r;
      if (r.conflict && !res.conflict) res = r;
      else if (r.duplicate && !res.conflict && !res.duplicate) res = r;
      else if (!r.conflict && !r.duplicate) { res.replaced = (res.replaced || []).concat(r.replaced || []); res.ok = true; }
    }
    if (res.ok) { delete res.duplicate; delete res.conflict; }
    month = parts.map(function (x) { return x.month; }).join(',');
    rec.company = company; rec.month = month;
    if (res.conflict && !res.ok) {
      rec.status = 'aguardando'; rec.conflict = true;
      rec.msg = res.overlap + ' lançamentos repetidos com ' + res.conflict;
      parsedMem[path] = parsed;
      return;
    }
    delete rec.conflict;
    if (res.duplicate && !res.ok) { rec.status = 'duplicado'; rec.msg = (res.contained ? 'Já contido em ' : 'Mesmo conteúdo de ') + res.duplicate; }
    else {
      rec.status = 'ok'; rec.msg = parsed.rows.filter(function (x) { return !x.saldo; }).length + ' lançamentos';
      if (res.replaced && res.replaced.length) {
        res.replaced.forEach(function (k) {
          var p = k.indexOf('pasta:') === 0 ? k.slice(6) : '';
          if (p) patches.push({ path: p, msg: 'Substituído por ' + name + ' (mais completo)' });
        });
        rec.msg += ' · substituiu ' + res.replaced.length + ' arquivo' + (res.replaced.length > 1 ? 's' : '');
      }
    }
    delete parsedMem[path];
  }

  async function scan(force) {
    if (!dir || !granted || scanning) return;
    scanning = true;
    status('Lendo a pasta…');
    try {
      var list = await walk(dir, [], 0, []);
      var idx = index();
      if (idx.reader !== READER_VERSION) force = true;
      var seen = {};
      handles = {};
      var todo = [];
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        seen[e.path] = 1; handles[e.path] = e;
        var file = await e.handle.getFile();
        var sig = file.size + ':' + file.lastModified;
        var rec = idx.files[e.path];
        if (force || !rec || rec.sig !== sig || (rec.status === 'aguardando' && !parsedMem[e.path])) todo.push({ e: e, file: file });
      }
      for (var j = 0; j < todo.length; j++) {
        status('Lendo ' + (j + 1) + ' de ' + todo.length + ': ' + todo[j].e.name);
        await processEntry(todo[j].e, todo[j].file, idx);
      }
      Object.keys(idx.files).forEach(function (p) { if (!seen[p]) delete idx.files[p]; });
      idx.lastScan = new Date().toISOString();
      idx.folderName = dir.name;
      idx.reader = READER_VERSION;
      applyPatches(idx);
      setJSON(INDEX_KEY, idx);
      // Resolve pendentes que agora têm empresa (ex.: empresa criada depois).
      retryPending(false);
    } catch (err) {
      status('Não foi possível ler a pasta: ' + (err && err.message ? err.message : 'erro desconhecido'), 'error');
      scanning = false;
      return;
    }
    scanning = false;
    renderBox();
  }

  function retryPending(save) {
    var idx = index(), changed = false;
    Object.keys(idx.files).forEach(function (p) {
      var rec = idx.files[p];
      if (rec.status !== 'aguardando' || !parsedMem[p] || !handles[p]) return;
      var who = identify(handles[p], parsedMem[p]);
      if (who.company && rec.month && !rec.conflict) { doImport(p, handles[p].name, parsedMem[p], who.company, rec.month, rec); changed = true; }
    });
    applyPatches(idx);
    if (changed || save) setJSON(INDEX_KEY, idx);
  }

  /* ---------------- Tela ---------------- */
  function status(text, kind) {
    var el = $('folderStatus');
    el.textContent = text || '';
    el.className = 'fd-status' + (kind ? ' is-' + kind : '');
  }

  function renderBox() {
    var idx = index();
    $('folderConnect').hidden = !!dir;
    $('folderAllow').hidden = !(dir && !granted);
    $('folderRefresh').hidden = !(dir && granted);
    $('folderDisconnect').hidden = !dir;
    $('folderName').textContent = dir ? dir.name : '';
    $('folderName').hidden = !dir;

    var files = Object.keys(idx.files).map(function (p) { var r = idx.files[p]; r.path = p; return r; });
    var n = { ok: 0, aguardando: 0, duplicado: 0, ignorado: 0, erro: 0 };
    files.forEach(function (r) { if (n[r.status] !== undefined) n[r.status]++; });
    if (!dir) { status(''); }
    else if (!granted) { status(''); }
    else if (!scanning) {
      var parts = [n.ok + ' importados'];
      if (n.aguardando) parts.push(n.aguardando + ' aguardando');
      if (n.duplicado) parts.push(n.duplicado + ' duplicados');
      if (n.ignorado) parts.push(n.ignorado + ' ignorados');
      if (n.erro) parts.push(n.erro + ' com erro');
      status('Atualizado ' + ago(idx.lastScan) + ' · ' + parts.join(' · '));
    }

    // Aguardando empresa ou mês
    var pend = files.filter(function (r) { return r.status === 'aguardando'; });
    var newNames = {};
    pend.forEach(function (r) { if (!r.company && r.suggestion && !Shell.companyByName(r.suggestion)) newNames[r.suggestion.toUpperCase()] = r.suggestion; });
    var names = Object.keys(newNames).map(function (k) { return newNames[k]; });
    $('folderCreate').hidden = !names.length || !granted;
    $('folderCreate').textContent = 'Criar ' + (names.length === 1 ? 'empresa “' + names[0] + '”' : names.length + ' empresas pelos nomes dos arquivos');
    $('folderCreate').setAttribute('data-names', JSON.stringify(names));

    var dl = '<datalist id="fdCompanies">' + Shell.COMPANIES.map(function (c) { return '<option value="' + esc(c.name) + '"></option>'; }).join('') + '</datalist>';
    $('folderPending').innerHTML = pend.length ? dl + pend.map(function (r) {
      var co = r.company ? Shell.companyName(r.company) : '';
      return '<li data-path="' + esc(r.path) + '"><div class="fd-file"><strong>' + esc(r.path) + '</strong><span>' + esc(r.msg) + (r.account ? ' · conta ' + esc(r.account) : '') + '</span></div>' +
        '<input class="fd-co" list="fdCompanies" placeholder="Empresa" aria-label="Empresa" value="' + esc(co) + '">' +
        '<input class="fd-month" type="month" aria-label="Mês" value="' + esc((r.month || '').split(',')[0]) + '">' +
        '<label class="fd-remember"><input type="checkbox" checked> Lembrar</label>' +
        '<button type="button" class="ex-btn ex-primary fd-import"' + (granted ? '' : ' disabled') + '>' + (r.conflict ? 'Importar mesmo assim' : 'Importar') + '</button>' +
        '<button type="button" class="ex-btn fd-ignore">Ignorar</button></li>';
    }).join('') : '';
    $('folderPending').hidden = !pend.length;

    // Todos os arquivos (detalhe)
    var order = { aguardando: 0, erro: 1, duplicado: 2, ok: 3, ignorado: 4 };
    var labels = { ok: 'Importado', aguardando: 'Aguardando', duplicado: 'Duplicado', ignorado: 'Ignorado', erro: 'Erro' };
    files.sort(function (a, b) { return (order[a.status] - order[b.status]) || a.path.localeCompare(b.path, 'pt-BR'); });
    $('folderFiles').innerHTML = files.map(function (r) {
      return '<tr class="fd-' + r.status + '"><td>' + esc(r.path) + '</td><td>' + esc(r.company ? Shell.companyName(r.company) : '—') + '</td><td>' + esc(r.month ? r.month.split(',').map(App.monthLabel).join(', ') : '—') + '</td><td><span class="fd-tag">' + labels[r.status] + '</span></td><td>' + esc(r.msg || '') + '</td></tr>';
    }).join('');
    $('folderDetails').hidden = !files.length;
  }

  async function connect() {
    try {
      var h = await window.showDirectoryPicker({ id: 'cf-extratos', mode: 'read', startIn: 'desktop' });
      dir = h; granted = true;
      await idbSet('extratos-dir', h);
      var idx = index();
      if (idx.folderName && idx.folderName !== h.name) setJSON(INDEX_KEY, { files: {}, lastScan: '', folderName: h.name });
      renderBox();
      await scan(false);
      startPolling();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      status('Não foi possível conectar a pasta.', 'error');
    }
  }
  async function allow() {
    if (!dir) return;
    try { granted = (await dir.requestPermission({ mode: 'read' })) === 'granted'; } catch (e) { granted = false; }
    renderBox();
    if (granted) { await scan(false); startPolling(); }
  }
  async function disconnect() {
    if (!window.confirm('Desconectar a pasta? Os extratos já importados continuam salvos.')) return;
    dir = null; granted = false; clearInterval(timer);
    await idbSet('extratos-dir', null);
    setJSON(INDEX_KEY, { files: {}, lastScan: '', folderName: '' });
    renderBox();
  }
  function startPolling() {
    clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden) scan(false); }, POLL_MS);
  }

  async function importPending(li) {
    var path = li.getAttribute('data-path');
    var c = Shell.companyByName(li.querySelector('.fd-co').value);
    var m = li.querySelector('.fd-month').value;
    if (!c) { status('Escolha uma empresa da lista para ' + path + '.', 'error'); return; }
    if (!/^\d{4}-\d{2}$/.test(m)) { status('Informe o mês de ' + path + '.', 'error'); return; }
    var parsed = parsedMem[path];
    if (!parsed && handles[path]) { try { parsed = await App.readAny(await handles[path].handle.getFile()); } catch (e) {} }
    if (!parsed) { status('Arquivo não encontrado na pasta: ' + path + '.', 'error'); return; }
    var idx = index(), rec = idx.files[path] || {};
    if (li.querySelector('.fd-remember input').checked) {
      var mp = mapa();
      mp.arquivos[Shell.slug(baseName(handles[path] ? handles[path].name : path.split('/').pop()))] = c.id;
      if (parsed.account) mp.contas[parsed.account] = c.id;
      setJSON(MAP_KEY, mp);
    }
    doImport(path, path.split('/').pop(), parsed, c.id, m, rec, rec.conflict);
    idx = index(); idx.files[path] = rec;
    applyPatches(idx);
    setJSON(INDEX_KEY, idx);
    renderBox();
  }

  /* ---------------- Eventos ---------------- */
  $('folderConnect').addEventListener('click', connect);
  $('folderAllow').addEventListener('click', allow);
  $('folderRefresh').addEventListener('click', function () { scan(false); });
  $('folderDisconnect').addEventListener('click', disconnect);
  $('folderCreate').addEventListener('click', function () {
    var names = JSON.parse(this.getAttribute('data-names') || '[]');
    if (!names.length) return;
    if (!window.confirm('Criar ' + names.length + (names.length === 1 ? ' empresa' : ' empresas') + ':\n\n' + names.join('\n'))) return;
    Shell.addCompanies(names);
    Shell.refreshCompanies();
    retryPending(true);
    renderBox();
  });
  $('folderPending').addEventListener('click', function (e) {
    var li = e.target.closest('li[data-path]'); if (!li) return;
    if (e.target.closest('.fd-import')) importPending(li);
    if (e.target.closest('.fd-ignore')) {
      var idx = index(), rec = idx.files[li.getAttribute('data-path')];
      if (rec) { rec.status = 'ignorado'; rec.msg = 'Ignorado manualmente'; setJSON(INDEX_KEY, idx); }
      renderBox();
    }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && dir && granted) scan(false); });

  async function init() {
    if (!SUPPORTED) { $('folderBox').classList.add('is-unsupported'); $('folderStatus').textContent = 'Pasta automática disponível no Chrome e no Edge.'; $('folderConnect').hidden = true; return; }
    var h = await idbGet('extratos-dir');
    if (h && typeof h.queryPermission === 'function') {
      dir = h;
      try { granted = (await h.queryPermission({ mode: 'read' })) === 'granted'; } catch (e) { granted = false; }
    }
    renderBox();
    if (dir && granted) { await scan(false); startPolling(); }
  }

  // Para testes e integração.
  window.ExtratoFolder = { _setDir: function (h) { dir = h; granted = true; renderBox(); return scan(false); }, scan: scan };
  init();
})();
