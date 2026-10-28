/*
  Central Financeira · Shell compartilhado (v2.1)
  - Desenha o menu lateral em todas as páginas da Central.
  - Registra, neste navegador, um resumo dos resultados de cada aplicação
    para alimentar os indicadores do painel. Não altera a lógica das aplicações.
*/
(function () {
  'use strict';

  var VERSION = '2.6';
  var root = document.documentElement;
  root.classList.add('cf-shell');

  // Preferência de menu recolhido (desktop) aplicada antes da pintura.
  try { if (localStorage.getItem('cf:sidebar') === 'collapsed') root.classList.add('cf-collapsed'); } catch (e) {}

  // Base da Central a partir do endereço deste script (funciona na raiz ou em subpasta).
  var script = document.currentScript;
  var BASE = script ? new URL('./', script.src).href : new URL('/', location.href).href;

  var ICONS = {
    painel: '<path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z"/>',
    difal: '<path d="M12 3v18M5 7h14M7 7l-3 7a3.5 3.5 0 0 0 6 0L7 7Zm10 0-3 7a3.5 3.5 0 0 0 6 0l-3-7Z"/>',
    'itau-mvp': '<path d="M3 7h13m0 0-3.5-3.5M16 7l-3.5 3.5M21 17H8m0 0 3.5-3.5M8 17l3.5 3.5"/>',
    'itau-dealer': '<path d="M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2V4Zm4 5h6m-6 4h6"/>',
    cielo: '<path d="M7 3h7l5 5v13H7V3Zm7 0v5h5M10 13h6m-6 4h6"/>',
    extrato: '<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3Zm3 5h6m-6 4h6m-6 4h4"/>',
    sair: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4m-4-4h11"/>',
    recolher: '<path d="M15 6l-6 6 6 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
  };
  function icon(name) {
    return '<svg class="cf-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
  }

  var MODULES = [
    { id: 'difal', group: 'Conciliações', label: 'Conciliação Banco Util', short: 'Banco Util', path: 'difal/' },
    { id: 'itau-mvp', group: 'Conciliações', label: 'Análise de pagamentos', short: 'Pagamentos', path: 'itau-mvp/' },
    { id: 'itau-dealer', group: 'Conciliações', label: 'Conciliação Cobrança', short: 'Cobrança', path: 'itau-dealer/' },
    { id: 'extrato', group: 'Conciliações', label: 'Extrato do mês', short: 'Extrato', path: 'extrato/' },
    { id: 'cielo', group: 'Cartões', label: 'Antecipação Cielo', short: 'Antecipação Cielo', path: 'cielo/?v=45' }
  ];

  /* ---------------- Empresas (v2.3) ---------------- */
  var DEFAULT_COMPANIES = [
    { id: 'veiculos', name: 'Veículos' },
    { id: 'france', name: 'France' },
    { id: 'motors', name: 'Motors' },
    { id: 'suzuki', name: 'Suzuki' }
  ];
  function loadCompanies() {
    try {
      var list = JSON.parse(localStorage.getItem('cf:companies') || 'null');
      if (Array.isArray(list) && list.length && list.every(function (c) { return c && c.id && c.name; })) return list;
    } catch (e) {}
    return DEFAULT_COMPANIES.slice();
  }
  var COMPANIES = loadCompanies();
  function saveCompanies() { try { localStorage.setItem('cf:companies', JSON.stringify(COMPANIES)); } catch (e) {} }
  function slug(name) {
    return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  var DIFAL_BASE = 'difal_conciliacao_final_1_0';

  // Indicadores do painel contam a partir de 28/10/2026 11:14 (horário de Brasília).
  var INDICATORS_START = '2026-10-28T14:14:00.000Z';
  try {
    if (localStorage.getItem('cf:reset') !== INDICATORS_START) {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('cf:latest:') === 0 || k.indexOf('cf:events:') === 0 || k === 'cf:log') localStorage.removeItem(k);
      });
      localStorage.setItem('cf:reset', INDICATORS_START);
    }
  } catch (e) {}
  function companyById(id) {
    for (var i = 0; i < COMPANIES.length; i++) if (COMPANIES[i].id === id) return COMPANIES[i];
    return null;
  }
  function companyName(id) { var c = companyById(id); return c ? c.name : 'Sem empresa'; }
  function currentModule() {
    var path = location.pathname.replace(/\/index\.html$/, '/');
    for (var i = 0; i < MODULES.length; i++) {
      if (path.indexOf('/' + MODULES[i].id + '/') !== -1) return MODULES[i].id;
    }
    return 'painel';
  }
  function resolveCompany(mod) {
    if (mod === 'painel') return null;
    var m = location.hash.match(/empresa=([a-z0-9]+)/);
    if (m && companyById(m[1])) {
      try { localStorage.setItem('cf:company:' + mod, m[1]); } catch (e) {}
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      return m[1];
    }
    try { var v = localStorage.getItem('cf:company:' + mod); if (companyById(v)) return v; } catch (e) {}
    return null;
  }
  var ACTIVE = currentModule();
  var COMPANY = resolveCompany(ACTIVE);

  // Conciliação Banco Util: um período salvo por empresa.
  // O período salvo antes da separação por empresa é vinculado à primeira empresa escolhida.
  if (ACTIVE === 'difal') {
    try {
      localStorage.removeItem(DIFAL_BASE + '::__none');
      if (COMPANY) {
        var legacy = localStorage.getItem(DIFAL_BASE);
        var anyCompany = COMPANIES.some(function (c) { return localStorage.getItem(DIFAL_BASE + '::' + c.id) !== null; });
        if (legacy && !anyCompany) {
          localStorage.setItem(DIFAL_BASE + '::' + COMPANY, legacy);
          localStorage.removeItem(DIFAL_BASE);
          sessionStorage.setItem('cf:toast', 'Período já salvo vinculado a ' + companyName(COMPANY) + '.');
        }
      }
    } catch (e) {}
  }
  function storageKey(base) { return base + '::' + (COMPANY || '__none'); }
  function latestKey(id, company) { return 'cf:latest:' + id + (company ? ':' + company : ''); }
  function eventsKey(id, company) { return 'cf:events:' + id + (company ? ':' + company : ''); }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---------------- Armazenamento de indicadores ---------------- */
  var Store = {
    get: function (key, fallback) {
      try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove: function (key) { try { localStorage.removeItem(key); } catch (e) {} },
    log: function (entry) {
      var log = Store.get('cf:log', []);
      if (!Array.isArray(log)) log = [];
      log.unshift(entry);
      Store.set('cf:log', log.slice(0, 60));
    }
  };

  function parseMoney(text) {
    if (!text) return 0;
    var s = String(text).replace(/[^\d,.-]/g, '');
    if (!s) return 0;
    s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }
  function parseInt10(text) {
    var m = String(text || '').replace(/\./g, '').match(/-?\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }
  function countOf(text, re) { var m = re.exec(String(text || '')); return m ? parseInt10(m[1]) : parseInt10(text); }
  function txt(id) { var el = document.getElementById(id); return el ? el.textContent.trim() : ''; }

  // Como ler o resultado de cada aplicação (ids existentes nas páginas).
  var CAPTURE = {
    'itau-mvp': {
      watch: 'results',
      read: function () {
        return {
          itauCount: parseInt10(txt('ki')), itauValue: parseMoney(txt('kiv')),
          ok: parseInt10(txt('ko')), pending: parseInt10(txt('kd')), missing: countOf(txt('km'), /(\d[\d.]*)\s+n[aã]o\s+(?:encontrad|localizad)/i),
          dealerCount: parseInt10(txt('kde')), dealerValue: parseMoney(txt('kdev'))
        };
      },
      describe: function (d) { return d.ok + ' batem, ' + d.pending + ' pendentes'; }
    },
    'itau-dealer': {
      watch: 'results',
      read: function () {
        return {
          itauCount: parseInt10(txt('kpiItau')), itauValue: parseMoney(txt('kpiItauTotal')),
          ok: parseInt10(txt('kpiOk')), pending: parseInt10(txt('kpiDiff')),
          missing: parseInt10(txt('kpiMissing')), review: parseInt10(txt('kpiAdjust'))
        };
      },
      describe: function (d) { return d.ok + ' batem, ' + d.pending + ' com divergência'; }
    },
    'cielo': {
      watch: 'results',
      logOnChange: false, // registra na atividade somente quando o CIELO04 é gerado
      read: function () {
        return {
          titles: parseInt10(txt('titles')), gross: parseMoney(txt('gross')),
          totalClear: parseMoney(txt('totalClear')), noteFee: parseMoney(txt('noteFee')),
          cielo04: parseMoney(txt('cielo04Total')), settlementDate: txt('settlementDateSummary')
        };
      },
      events: [{ id: 'downloadTxt', describe: function (d) { return 'Arquivo CIELO04 gerado com ' + d.titles + ' títulos'; } }]
    }
  };

  var session = null; // último resultado registrado nesta página (para trocar de empresa)

  function startCapture(id) {
    var cfg = CAPTURE[id];
    if (!cfg) return;
    var target = document.getElementById(cfg.watch);
    if (!target) return;
    var timer = null;

    function snapshot() {
      if (target.classList.contains('hidden')) return null;
      return { module: id, company: COMPANY, at: new Date().toISOString(), data: cfg.read() };
    }

    function record() {
      if (!COMPANY) return;
      var snap = snapshot();
      if (!snap) return;
      var key = latestKey(id, COMPANY);
      var prev = Store.get(key, null);
      if (prev && JSON.stringify(prev.data) === JSON.stringify(snap.data)) return;
      Store.set(key, snap);
      var logIds = [];
      if (cfg.logOnChange !== false) {
        var logId = newId(); logIds.push(logId);
        Store.log({ id: logId, module: id, company: COMPANY, at: snap.at, text: cfg.describe(snap.data), kind: snap.data.pending ? 'warn' : 'ok' });
      }
      session = { id: id, company: COMPANY, snap: snap, prev: prev, logIds: logIds, files: 0 };
    }

    new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(record, 900);
    }).observe(target, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true, characterData: true });

    (cfg.events || []).forEach(function (ev) {
      var btn = document.getElementById(ev.id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (btn.disabled || !COMPANY) return;
        var snap = snapshot();
        if (!snap) return;
        var key = latestKey(id, COMPANY);
        var prev = Store.get(key, null);
        Store.set(key, snap);
        var ek = eventsKey(id, COMPANY);
        var counts = Store.get(ek, { files: 0 });
        counts.files = (counts.files || 0) + 1;
        counts.lastAt = snap.at;
        Store.set(ek, counts);
        var logId = newId();
        Store.log({ id: logId, module: id, company: COMPANY, at: snap.at, text: ev.describe(snap.data), kind: 'ok' });
        if (session && session.id === id && session.company === COMPANY) {
          session.snap = snap; session.files++; session.logIds.push(logId);
        } else {
          session = { id: id, company: COMPANY, snap: snap, prev: prev, logIds: [logId], files: 1 };
        }
      });
    });
  }

  // Troca de empresa depois de uma análise: o resultado passa para a empresa escolhida.
  function moveSession(to) {
    if (!session || session.company === to) return;
    var from = session.company, id = session.id;
    if (session.prev) Store.set(latestKey(id, from), session.prev); else Store.remove(latestKey(id, from));
    var newPrev = Store.get(latestKey(id, to), null);
    var snap = JSON.parse(JSON.stringify(session.snap)); snap.company = to;
    Store.set(latestKey(id, to), snap);
    if (session.files) {
      var a = Store.get(eventsKey(id, from), { files: 0 }), b = Store.get(eventsKey(id, to), { files: 0 });
      a.files = Math.max(0, (a.files || 0) - session.files);
      b.files = (b.files || 0) + session.files; b.lastAt = snap.at;
      Store.set(eventsKey(id, from), a); Store.set(eventsKey(id, to), b);
    }
    var log = Store.get('cf:log', []);
    if (Array.isArray(log)) {
      log.forEach(function (e) { if (e && session.logIds.indexOf(e.id) !== -1) e.company = to; });
      Store.set('cf:log', log);
    }
    session.company = to; session.prev = newPrev; session.snap = snap;
  }

  /* ---------------- Pendências por aplicação (para os selos do menu) ---------------- */
  function difalStateFor(company) {
    var s = Store.get(company ? DIFAL_BASE + '::' + company : DIFAL_BASE, null);
    return s && s.analyses && Array.isArray(s.bankRows) ? s : null;
  }
  function pendingOne(id, company) {
    if (id === 'difal') {
      var s = difalStateFor(company);
      if (!s) return 0;
      return Object.keys(s.analyses).reduce(function (sum, d) {
        var a = s.analyses[d];
        if (!a || !(a.analyzedAt >= INDICATORS_START)) return sum;
        var x = a.summary || {};
        return sum + (x.divergenceCount || 0) + (x.missingCount || 0);
      }, 0);
    }
    if (id === 'extrato') { var ex = extratoSummary(company); return ex ? ex.pendente + ex.analise : 0; }
    var latest = Store.get(latestKey(id, company), null);
    return latest && latest.data && latest.data.pending ? latest.data.pending : 0;
  }
  // Extrato do mês: lançamentos marcados como Pendente / Em análise (todos os meses salvos).
  function extratoSummary(company) {
    if (!company) return null;
    var st = Store.get('cf:extrato:' + company, null);
    if (!st || !st.months) return null;
    var out = { pendente: 0, analise: 0, rows: 0, months: 0, lastMonth: st.lastMonth || '', at: '' };
    Object.keys(st.months).forEach(function (m) {
      var mo = st.months[m]; if (!mo || !Array.isArray(mo.rows)) return;
      out.months++; out.rows += mo.rows.length;
      if (mo.importedAt > out.at) out.at = mo.importedAt;
      var ids = {}; mo.rows.forEach(function (r) { ids[r.id] = 1; });
      Object.keys(mo.marks || {}).forEach(function (rid) {
        if (!ids[rid]) return;
        var mk = mo.marks[rid];
        if (mk.status === 'Pendente') out.pendente++;
        else if (mk.status === 'Em análise') out.analise++;
        if (mk.at > out.at) out.at = mk.at;
      });
    });
    return out.months ? out : null;
  }
  // Sem empresa informada: soma todas as empresas.
  function pendingFor(id, company) {
    if (company !== undefined) return pendingOne(id, company);
    return COMPANIES.reduce(function (sum, c) { return sum + pendingOne(id, c.id); }, pendingOne(id, null));
  }

  /* ---------------- Escolha da empresa (barra dentro da tela) ---------------- */
  var RELOAD_ON_SWITCH = { difal: true, extrato: true, 'itau-mvp': true };
  function escHtml(v) { return String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var MAX_BUTTONS = 6;
  function companyByName(name) {
    var k = slug(name);
    for (var i = 0; i < COMPANIES.length; i++) if (COMPANIES[i].id === k || slug(COMPANIES[i].name) === k) return COMPANIES[i];
    return null;
  }
  function renderCompanyBar() {
    var bar = document.getElementById('cf-pagebar');
    if (!bar) return;
    var open = bar.querySelector('.cf-co-pop') && !bar.querySelector('.cf-co-pop').hidden;
    var picker = COMPANIES.length > MAX_BUTTONS
      ? '<div class="cf-co-pick"><input type="search" class="cf-co-search" list="cf-co-dl" autocomplete="off" aria-label="Empresa" placeholder="Buscar empresa" value="' + escHtml(COMPANY ? companyName(COMPANY) : '') + '">' +
        '<datalist id="cf-co-dl">' + COMPANIES.map(function (c) { return '<option value="' + escHtml(c.name) + '"></option>'; }).join('') + '</datalist>' +
        '<span class="cf-co-count">' + COMPANIES.length + ' empresas</span></div>'
      : '<div class="cf-seg" role="radiogroup" aria-label="Empresa">' + COMPANIES.map(function (c) {
        var on = c.id === COMPANY;
        return '<button type="button" role="radio" aria-checked="' + on + '" data-company="' + escHtml(c.id) + '" class="cf-co' + (on ? ' is-on' : '') + '">' + escHtml(c.name) + '</button>';
      }).join('') + '</div>';
    bar.innerHTML = '<span class="cf-pagebar-label">Empresa</span>' + picker +
      '<div class="cf-co-wrap"><button type="button" class="cf-co-manage" aria-expanded="' + (open ? 'true' : 'false') + '">Empresas</button>' +
      '<div class="cf-co-pop"' + (open ? '' : ' hidden') + '>' +
        '<div class="cf-co-add"><textarea class="cf-co-input" rows="3" placeholder="Uma empresa por linha" aria-label="Novas empresas, uma por linha"></textarea><button type="button" class="cf-co-addbtn">Adicionar</button></div>' +
        '<ul class="cf-co-list">' + COMPANIES.map(function (c) {
          return '<li><span>' + escHtml(c.name) + '</span><button type="button" class="cf-co-del" data-del="' + escHtml(c.id) + '"' + (COMPANIES.length < 2 ? ' disabled' : '') + '>Remover</button></li>';
        }).join('') + '</ul>' +
      '</div></div>';
  }
  function refreshCompanyUI() {
    renderCompanyBar();
    root.setAttribute('data-empresa', COMPANY || '');
  }
  function buildCompanyBar() {
    if (ACTIVE === 'painel') return;
    var main = document.querySelector('main');
    if (!main) return;
    var bar = document.createElement('div');
    bar.id = 'cf-pagebar'; bar.className = 'cf-pagebar';
    main.insertBefore(bar, main.firstChild);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('.cf-co');
      if (b) { chooseCompany(b.getAttribute('data-company')); return; }
      if (e.target.closest('.cf-co-manage')) {
        var pop = bar.querySelector('.cf-co-pop'); pop.hidden = !pop.hidden;
        bar.querySelector('.cf-co-manage').setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
        if (!pop.hidden) bar.querySelector('.cf-co-input').focus();
        return;
      }
      if (e.target.closest('.cf-co-addbtn')) { addCompany(bar.querySelector('.cf-co-input').value); return; }
      var del = e.target.closest('.cf-co-del');
      if (del) removeCompany(del.getAttribute('data-del'));
    });
    bar.addEventListener('change', function (e) {
      if (!e.target.classList.contains('cf-co-search')) return;
      var c = companyByName(e.target.value);
      if (c) chooseCompany(c.id); else e.target.value = COMPANY ? companyName(COMPANY) : '';
    });
    bar.addEventListener('focusin', function (e) { if (e.target.classList.contains('cf-co-search')) e.target.select(); });
    bar.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.classList.contains('cf-co-search')) { e.preventDefault(); var c = companyByName(e.target.value); if (c) chooseCompany(c.id); }
      if (e.key === 'Escape') { var pop = bar.querySelector('.cf-co-pop'); if (pop && !pop.hidden) { pop.hidden = true; bar.querySelector('.cf-co-manage').focus(); } }
    });
    document.addEventListener('click', function (e) {
      var pop = bar.querySelector('.cf-co-pop');
      if (pop && !pop.hidden && !e.target.closest('.cf-co-wrap')) { pop.hidden = true; bar.querySelector('.cf-co-manage').setAttribute('aria-expanded', 'false'); }
    });
  }
  // Aceita uma ou várias empresas (uma por linha, ou separadas por ; ).
  function addCompanies(names) {
    var added = [];
    names.forEach(function (raw) {
      var name = String(raw || '').trim().replace(/\s+/g, ' ');
      var id = slug(name);
      if (!id || companyById(id)) return;
      COMPANIES.push({ id: id, name: name });
      added.push(id);
    });
    if (added.length) saveCompanies();
    return added;
  }
  function addCompany(text) {
    var names = String(text || '').split(/[\n;]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (!names.length) { toast('Informe o nome da empresa.', 'error'); return; }
    var added = addCompanies(names);
    renderCompanyBar();
    var pop = document.querySelector('#cf-pagebar .cf-co-pop'); if (pop) { pop.hidden = false; var inp = pop.querySelector('.cf-co-input'); if (inp) inp.focus(); }
    if (!added.length) toast(names.length === 1 ? names[0] + ' já está na lista.' : 'Essas empresas já estão na lista.', 'error');
    else toast(added.length === 1 ? 'Empresa adicionada: ' + companyName(added[0]) : added.length + ' empresas adicionadas' + (added.length < names.length ? ' (' + (names.length - added.length) + ' já existiam)' : ''));
  }
  function removeCompany(id) {
    var c = companyById(id);
    if (!c || COMPANIES.length < 2) return;
    if (!window.confirm('Remover ' + c.name + ' da lista de empresas? Os dados já salvos voltam se ela for adicionada de novo com o mesmo nome.')) return;
    COMPANIES = COMPANIES.filter(function (x) { return x.id !== id; });
    saveCompanies();
    if (COMPANY === id) {
      try { localStorage.removeItem('cf:company:' + ACTIVE); } catch (e) {}
      if (RELOAD_ON_SWITCH[ACTIVE]) { location.reload(); return; }
      COMPANY = null;
      renderCompanyBar();
      openCompanyModal();
      return;
    }
    renderCompanyBar();
  }
  function chooseCompany(id) {
    if (!companyById(id)) return;
    closeCompanyModal();
    if (id === COMPANY) return;
    var prev = COMPANY;
    try { localStorage.setItem('cf:company:' + ACTIVE, id); } catch (e) {}
    if (RELOAD_ON_SWITCH[ACTIVE]) {
      try { sessionStorage.setItem('cf:toast', 'Empresa: ' + companyName(id)); } catch (e) {}
      location.reload();
      return;
    }
    if (prev) moveSession(id);
    COMPANY = id;
    refreshCompanyUI();
    toast('Empresa: ' + companyName(id));
  }
  function openCompanyModal() {
    if (document.getElementById('cf-modal')) return;
    var m = document.createElement('div');
    m.id = 'cf-modal'; m.className = 'cf-modal';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'cf-modal-title');
    m.innerHTML = '<div class="cf-modal-box"><h2 id="cf-modal-title">Escolha a empresa</h2>' +
      (COMPANIES.length > MAX_BUTTONS ? '<input type="search" class="cf-modal-search" placeholder="Buscar empresa" aria-label="Buscar empresa">' : '') +
      '<div class="cf-modal-options">' +
      COMPANIES.map(function (c) { return '<button type="button" data-company="' + escHtml(c.id) + '">' + escHtml(c.name) + '</button>'; }).join('') +
      '</div><a class="cf-modal-back" href="' + BASE + '">Voltar ao painel</a></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-company]');
      if (b) chooseCompany(b.getAttribute('data-company'));
    });
    var search = m.querySelector('.cf-modal-search');
    if (search) {
      search.addEventListener('input', function () {
        var q = slug(search.value);
        Array.prototype.forEach.call(m.querySelectorAll('.cf-modal-options button'), function (b) { b.hidden = q && slug(b.textContent).indexOf(q) === -1; });
      });
      search.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var vis = Array.prototype.filter.call(m.querySelectorAll('.cf-modal-options button'), function (b) { return !b.hidden; });
        if (vis.length) chooseCompany(vis[0].getAttribute('data-company'));
      });
      search.focus();
    } else { var first = m.querySelector('button'); if (first) first.focus(); }
  }
  function closeCompanyModal() { var m = document.getElementById('cf-modal'); if (m) m.parentNode.removeChild(m); }

  /* ---------------- Menu lateral ---------------- */
  function buildSidebar(active) {
    var aside = document.createElement('aside');
    aside.className = 'cf-sidebar';
    aside.id = 'cf-sidebar';
    aside.setAttribute('aria-label', 'Menu da Central Financeira');

    var html = '';
    html += '<div class="cf-brand"><a href="' + BASE + '" class="cf-brand-link"><span class="cf-mark">CF</span><span class="cf-brand-text"><strong>Central Financeira</strong></span></a>';
    html += '<button type="button" class="cf-collapse" aria-label="Recolher menu" title="Recolher menu">' + icon('recolher') + '</button></div>';
    html += '<nav class="cf-nav">';
    html += '<a class="cf-item' + (active === 'painel' ? ' is-active' : '') + '" href="' + BASE + '"' + (active === 'painel' ? ' aria-current="page"' : '') + '>' + icon('painel') + '<span class="cf-label">Painel</span></a>';

    var lastGroup = '';
    MODULES.forEach(function (m) {
      if (m.group !== lastGroup) { html += '<p class="cf-group">' + m.group + '</p>'; lastGroup = m.group; }
      var pend = pendingFor(m.id);
      var isActive = active === m.id;
      html += '<a class="cf-item' + (isActive ? ' is-active' : '') + '" href="' + BASE + m.path + '" title="' + m.label + '"' + (isActive ? ' aria-current="page"' : '') + '>' + icon(m.id) +
        '<span class="cf-label">' + m.label + '</span>' +
        (pend ? '<span class="cf-pill" title="' + pend + ' pendente(s)">' + (pend > 99 ? '99+' : pend) + '</span>' : '') + '</a>';
    });
    html += '</nav>';

    html += '<div class="cf-foot">';
    html += '<a class="cf-item cf-logout" href="/__logout">' + icon('sair') + '<span class="cf-label">Sair</span></a>';
    html += '<p class="cf-version cf-label">Versão ' + VERSION + '</p></div>';
    aside.innerHTML = html;

    var mobileBar = document.createElement('div');
    mobileBar.className = 'cf-mobilebar';
    mobileBar.innerHTML = '<button type="button" class="cf-burger" aria-controls="cf-sidebar" aria-expanded="false" aria-label="Abrir menu">' + icon('menu') + '</button><a href="' + BASE + '" class="cf-mobile-title"><span class="cf-mark">CF</span>Central Financeira</a>' +
''; 

    var scrim = document.createElement('div');
    scrim.className = 'cf-scrim';

    document.body.insertBefore(scrim, document.body.firstChild);
    document.body.insertBefore(aside, document.body.firstChild);
    document.body.insertBefore(mobileBar, document.body.firstChild);


    var burger = mobileBar.querySelector('.cf-burger');
    function setOpen(open) {
      root.classList.toggle('cf-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { var first = aside.querySelector('.cf-item'); if (first) first.focus(); }
    }
    burger.addEventListener('click', function () { setOpen(!root.classList.contains('cf-open')); });
    scrim.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('cf-open')) { setOpen(false); burger.focus(); } });

    aside.querySelector('.cf-collapse').addEventListener('click', function () {
      var collapsed = root.classList.toggle('cf-collapsed');
      try { localStorage.setItem('cf:sidebar', collapsed ? 'collapsed' : 'expanded'); } catch (e) {}
    });
  }


  /* ---------------- Arrastar e soltar / colar arquivos (v2.1) ----------------
     Todo <input type="file"> da Central passa a aceitar:
     - arrastar e soltar sobre o quadro do campo;
     - Ctrl+V de um arquivo copiado no Explorer/Finder.
     O arquivo é entregue ao próprio input e o evento "change" é disparado,
     então cada aplicação processa exatamente como se o arquivo tivesse sido selecionado. */
  var DROP_CONFIG = {
    fileInput:     { zone: '.card',  label: 'Solte aqui a planilha da Cielo' },
    bankFile:      { zone: '.panel', label: 'Solte aqui a planilha do Banco Util' },
    restoreInput:  { zone: '.panel', label: 'Solte aqui o backup (.json) para restaurar', hint: false },
    itauFile:      { zone: '.card',  label: 'Solte aqui o arquivo do Itaú (Excel, HTML ou PDF)' },
    companionFile: { zone: '#companionBox', label: 'Solte aqui o arquivo ou a pasta auxiliar', folders: true, hint: false },
    companionFolder: { skip: true },
    dealerFile:    { zone: '.card',  label: 'Solte aqui o Excel do Dealer' },
    pdfFile:       { zone: '.ex-card:not(.fd-card)', label: 'Solte aqui o extrato (PDF ou Excel)' }
  };
  var dropZones = [];
  var lastZone = null;

  function acceptTokens(input) {
    return String(input.getAttribute('accept') || '').split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean);
  }
  function accepts(input, file) {
    var tokens = acceptTokens(input);
    if (!tokens.length) return true;
    var name = file.name.toLowerCase(), type = String(file.type || '').toLowerCase();
    return tokens.some(function (t) {
      if (t.charAt(0) === '.') return name.slice(-t.length) === t;
      if (t.slice(-2) === '/*') return type.indexOf(t.slice(0, -1)) === 0;
      return type === t;
    });
  }
  function formatsText(input) {
    var ext = acceptTokens(input).filter(function (t) { return t.charAt(0) === '.'; });
    return ext.length ? ext.join(', ') : 'o formato indicado';
  }
  function isVisible(el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }

  function toast(msg, kind) {
    var el = document.getElementById('cf-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cf-toast'; el.className = 'cf-toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'cf-toast is-show' + (kind === 'error' ? ' is-error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = 'cf-toast'; }, 3600);
  }

  // Lê arquivos soltos, incluindo o conteúdo de pastas.
  function readEntry(entry, out) {
    return new Promise(function (resolve) {
      if (!entry) return resolve();
      if (entry.isFile) {
        entry.file(function (f) { out.push({ file: f, nested: true }); resolve(); }, function () { resolve(); });
      } else if (entry.isDirectory) {
        var reader = entry.createReader(), all = [];
        (function next() {
          reader.readEntries(function (batch) {
            if (!batch.length) return Promise.all(all.map(function (e) { return readEntry(e, out); })).then(resolve);
            all = all.concat(Array.prototype.slice.call(batch)); next();
          }, function () { resolve(); });
        })();
      } else resolve();
    });
  }
  function collectDropped(dt, allowFolders) {
    var items = dt.items ? Array.prototype.slice.call(dt.items) : [];
    var hasDir = allowFolders && items.some(function (it) { var e = it.webkitGetAsEntry && it.webkitGetAsEntry(); return e && e.isDirectory; });
    if (!hasDir) return Promise.resolve(Array.prototype.slice.call(dt.files || []));
    var out = [];
    var entries = items.map(function (it) { return it.webkitGetAsEntry && it.webkitGetAsEntry(); });
    return Promise.all(entries.map(function (e) {
      if (e && e.isFile) return new Promise(function (r) { e.file(function (f) { out.push({ file: f, nested: false }); r(); }, function () { r(); }); });
      return readEntry(e, out);
    })).then(function () {
      // Arquivos soltos diretamente vêm antes dos que estavam dentro de pastas.
      out.sort(function (a, b) { return (a.nested ? 1 : 0) - (b.nested ? 1 : 0); });
      return out.map(function (x) { return x.file; });
    });
  }

  function deliver(zone, files, how) {
    var input = zone.input;
    var ok = files.filter(function (f) { return accepts(input, f); });
    var rejected = files.length - ok.length;
    if (!ok.length) {
      toast((files.length === 1 ? 'Formato não aceito neste campo: ' + files[0].name : 'Nenhum arquivo aceito neste campo') + '. Use ' + formatsText(input) + '.', 'error');
      return false;
    }
    if (!input.multiple) ok = ok.slice(0, 1);
    try {
      var dt = new DataTransfer();
      ok.forEach(function (f) { dt.items.add(f); });
      input.files = dt.files;
    } catch (e) {
      toast('Este navegador não permite ' + how + ' arquivos aqui. Use o botão de seleção.', 'error');
      return false;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    var extra = rejected ? ' (' + rejected + ' ignorado' + (rejected > 1 ? 's' : '') + ' por formato)' : '';
    var extraMulti = (!input.multiple && files.length > 1) ? ' Somente o primeiro foi usado.' : '';
    toast((ok.length === 1 ? 'Arquivo recebido: ' + ok[0].name : ok.length + ' arquivos recebidos') + extra + '.' + extraMulti);
    return true;
  }

  function zoneFor(input) {
    var cfg = DROP_CONFIG[input.id] || {};
    if (cfg.skip) return null;
    var zone = cfg.zone ? (cfg.zone.charAt(0) === '#' ? document.querySelector(cfg.zone) : input.closest(cfg.zone)) : null;
    if (!zone) zone = input.closest('label') || (input.id && document.querySelector('label[for="' + input.id + '"]')) || input.parentElement;
    if (!zone) return null;
    var label = cfg.label || 'Solte o arquivo aqui';
    return { el: zone, input: input, label: label, folders: !!cfg.folders || input.hasAttribute('webkitdirectory'), hint: cfg.hint !== false };
  }

  function innermostZone(target) {
    var best = null;
    dropZones.forEach(function (z) {
      if (!isVisible(z.el) || !z.el.contains(target)) return;
      if (!best || best.el.contains(z.el)) best = z;
    });
    return best;
  }

  function setupDropZones() {
    var inputs = document.querySelectorAll('input[type="file"]');
    if (!inputs.length) return;
    Array.prototype.forEach.call(inputs, function (input) {
      var z = zoneFor(input);
      if (!z) return;
      z.el.classList.add('cf-dropzone');
      z.el.setAttribute('data-drop-label', z.label);
      dropZones.push(z);
    });

    var depth = 0;
    function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return t && Array.prototype.indexOf.call(t, 'Files') !== -1; }
    function clearDrag() {
      depth = 0; root.classList.remove('cf-dragging');
      dropZones.forEach(function (z) { z.el.classList.remove('cf-drop-over'); });
    }

    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      depth++; root.classList.add('cf-dragging');
    });
    window.addEventListener('dragleave', function (e) {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) clearDrag();
    });
    window.addEventListener('dragover', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); // impede o navegador de abrir o arquivo e sair da página
      var z = innermostZone(e.target);
      dropZones.forEach(function (x) { x.el.classList.toggle('cf-drop-over', x === z); });
      e.dataTransfer.dropEffect = z ? 'copy' : 'none';
    });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      var z = innermostZone(e.target);
      clearDrag();
      if (!z) { toast('Solte o arquivo sobre um dos quadros destacados.', 'error'); return; }
      lastZone = z;
      collectDropped(e.dataTransfer, z.folders).then(function (files) {
        if (files.length) deliver(z, files, 'soltar');
      });
    });
    window.addEventListener('dragend', clearDrag);

    // Lembra o último quadro usado, para saber onde colar.
    document.addEventListener('pointerdown', function (e) { var z = innermostZone(e.target); if (z) lastZone = z; }, true);
    document.addEventListener('focusin', function (e) { var z = innermostZone(e.target); if (z) lastZone = z; });

    document.addEventListener('paste', function (e) {
      var cd = e.clipboardData;
      var files = cd && cd.files ? Array.prototype.slice.call(cd.files) : [];
      if (!files.length) return;
      // Colar texto (ex.: grade copiada do Excel) em campos de texto continua normal.
      var t = e.target, editable = t && (t.isContentEditable || /^(TEXTAREA|INPUT)$/.test(t.tagName));
      if (editable && cd.getData && cd.getData('text/plain')) return;
      var visible = dropZones.filter(function (z) { return isVisible(z.el); });
      var target = (lastZone && visible.indexOf(lastZone) !== -1 && files.some(function (f) { return accepts(lastZone.input, f); })) ? lastZone
        : visible.filter(function (z) { return files.some(function (f) { return accepts(z.input, f); }); })[0];
      if (!target) return; // ex.: imagem copiada — nenhum campo aceita, segue o comportamento normal
      e.preventDefault();
      if (deliver(target, files, 'colar')) {
        target.el.classList.add('cf-drop-flash');
        setTimeout(function () { target.el.classList.remove('cf-drop-flash'); }, 900);
      }
    });
  }

  // API usada pelo painel.
  window.CentralShell = {
    MODULES: MODULES, get COMPANIES() { return COMPANIES; }, Store: Store, BASE: BASE, VERSION: VERSION,
    company: function () { return COMPANY; }, companyName: companyName,
    storageKey: storageKey, latestKey: latestKey, eventsKey: eventsKey,
    difalStateFor: difalStateFor, pendingFor: pendingFor, extratoSummary: extratoSummary,
    INDICATORS_START: INDICATORS_START,
    slug: slug, companyById: companyById, companyByName: companyByName, addCompanies: addCompanies,
    refreshCompanies: function () { renderCompanyBar(); }
  };

  function init() {
    var active = ACTIVE;
    buildSidebar(active);
    buildCompanyBar();
    refreshCompanyUI();
    startCapture(active);
    setupDropZones();
    if (active !== 'painel' && !COMPANY) openCompanyModal();
    try {
      var msg = sessionStorage.getItem('cf:toast');
      if (msg) { sessionStorage.removeItem('cf:toast'); setTimeout(function () { toast(msg); }, 300); }
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
