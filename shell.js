/*
  Central Financeira · Shell compartilhado (v2.1)
  - Desenha o menu lateral em todas as páginas da Central.
  - Registra, neste navegador, um resumo dos resultados de cada aplicação
    para alimentar os indicadores do painel. Não altera a lógica das aplicações.
*/
(function () {
  'use strict';

  var VERSION = '2.1';
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
    sair: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4m-4-4h11"/>',
    recolher: '<path d="M15 6l-6 6 6 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
  };
  function icon(name) {
    return '<svg class="cf-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
  }

  var MODULES = [
    { id: 'difal', group: 'Conciliações', label: 'DIFAL · Banco Util × Dealer', short: 'DIFAL', path: 'difal/' },
    { id: 'itau-mvp', group: 'Conciliações', label: 'Itaú · Pagamentos', short: 'Itaú pagamentos', path: 'itau-mvp/' },
    { id: 'itau-dealer', group: 'Conciliações', label: 'Itaú · Recebimentos e pagamentos', short: 'Itaú completa', path: 'itau-dealer/' },
    { id: 'cielo', group: 'Arquivos', label: 'Gerador CIELO04', short: 'CIELO04', path: 'cielo/?v=45' }
  ];

  /* ---------------- Armazenamento de indicadores ---------------- */
  var Store = {
    get: function (key, fallback) {
      try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
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
  function txt(id) { var el = document.getElementById(id); return el ? el.textContent.trim() : ''; }

  // Como ler o resultado de cada aplicação (ids existentes nas páginas).
  var CAPTURE = {
    'itau-mvp': {
      watch: 'results',
      read: function () {
        return {
          itauCount: parseInt10(txt('ki')), itauValue: parseMoney(txt('kiv')),
          ok: parseInt10(txt('ko')), pending: parseInt10(txt('kd')), missing: parseInt10(txt('km')),
          dealerCount: parseInt10(txt('kde')), dealerValue: parseMoney(txt('kdev'))
        };
      },
      describe: function (d) { return d.ok + ' conciliados, ' + d.pending + ' pendências'; }
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
      describe: function (d) { return d.ok + ' conciliados, ' + d.pending + ' divergências'; }
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
      events: [{ id: 'downloadTxt', describe: function (d) { return 'CIELO04 gerado · ' + d.titles + ' títulos'; } }]
    }
  };

  function currentModule() {
    var path = location.pathname.replace(/\/index\.html$/, '/');
    for (var i = 0; i < MODULES.length; i++) {
      if (path.indexOf('/' + MODULES[i].id + '/') !== -1) return MODULES[i].id;
    }
    return 'painel';
  }

  function startCapture(id) {
    var cfg = CAPTURE[id];
    if (!cfg) return;
    var target = document.getElementById(cfg.watch);
    if (!target) return;
    var timer = null;

    function snapshot() {
      if (target.classList.contains('hidden')) return null;
      var data = cfg.read();
      return { module: id, at: new Date().toISOString(), data: data };
    }

    function record() {
      var snap = snapshot();
      if (!snap) return;
      var sig = JSON.stringify(snap.data);
      var prev = Store.get('cf:latest:' + id, null);
      if (prev && JSON.stringify(prev.data) === sig) return;
      Store.set('cf:latest:' + id, snap);
      if (cfg.logOnChange !== false) Store.log({ module: id, at: snap.at, text: cfg.describe(snap.data), kind: snap.data.pending ? 'warn' : 'ok' });
    }

    new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(record, 900);
    }).observe(target, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true, characterData: true });

    (cfg.events || []).forEach(function (ev) {
      var btn = document.getElementById(ev.id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var snap = snapshot();
        if (!snap) return;
        Store.set('cf:latest:' + id, snap);
        var counts = Store.get('cf:events:' + id, { files: 0 });
        counts.files = (counts.files || 0) + 1;
        counts.lastAt = snap.at;
        Store.set('cf:events:' + id, counts);
        Store.log({ module: id, at: snap.at, text: ev.describe(snap.data), kind: 'ok' });
      });
    });
  }

  /* ---------------- Pendências por aplicação (para os selos do menu) ---------------- */
  function difalState() {
    var s = Store.get('difal_conciliacao_final_1_0', null);
    return s && s.analyses && Array.isArray(s.bankRows) ? s : null;
  }
  function pendingFor(id) {
    if (id === 'difal') {
      var s = difalState();
      if (!s) return 0;
      return Object.keys(s.analyses).reduce(function (sum, d) {
        var x = s.analyses[d].summary || {};
        return sum + (x.divergenceCount || 0) + (x.missingCount || 0);
      }, 0);
    }
    var latest = Store.get('cf:latest:' + id, null);
    return latest && latest.data && latest.data.pending ? latest.data.pending : 0;
  }

  /* ---------------- Menu lateral ---------------- */
  function buildSidebar(active) {
    var aside = document.createElement('aside');
    aside.className = 'cf-sidebar';
    aside.id = 'cf-sidebar';
    aside.setAttribute('aria-label', 'Menu da Central Financeira');

    var html = '';
    html += '<div class="cf-brand"><a href="' + BASE + '" class="cf-brand-link"><span class="cf-mark">CF</span><span class="cf-brand-text"><strong>Central Financeira</strong><small>Conciliação e arquivos</small></span></a>';
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
        (pend ? '<span class="cf-pill" title="' + pend + ' pendência(s) na última análise">' + (pend > 99 ? '99+' : pend) + '</span>' : '') + '</a>';
    });
    html += '</nav>';

    html += '<div class="cf-foot"><p class="cf-note"><span class="cf-dot"></span><span class="cf-label">Arquivos processados neste navegador</span></p>';
    html += '<a class="cf-item cf-logout" href="/__logout">' + icon('sair') + '<span class="cf-label">Sair</span></a>';
    html += '<p class="cf-version cf-label">Versão ' + VERSION + '</p></div>';
    aside.innerHTML = html;

    var mobileBar = document.createElement('div');
    mobileBar.className = 'cf-mobilebar';
    mobileBar.innerHTML = '<button type="button" class="cf-burger" aria-controls="cf-sidebar" aria-expanded="false" aria-label="Abrir menu">' + icon('menu') + '</button><a href="' + BASE + '" class="cf-mobile-title"><span class="cf-mark">CF</span>Central Financeira</a>';

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
    dealerFile:    { zone: '.card',  label: 'Solte aqui o Excel do Dealer' }
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

  function addHint(z) {
    if (!z.hint) return;
    var anchor = z.input.closest('label') || (z.input.id && document.querySelector('label[for="' + z.input.id + '"]'));
    if (!anchor || !anchor.parentNode) return;
    var p = document.createElement('p');
    p.className = 'cf-drop-hint';
    p.textContent = 'ou arraste o arquivo até este quadro · Ctrl+V cola um arquivo copiado';
    anchor.parentNode.insertBefore(p, anchor.nextSibling);
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
      addHint(z);
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
  window.CentralShell = { MODULES: MODULES, Store: Store, difalState: difalState, pendingFor: pendingFor, BASE: BASE, VERSION: VERSION };

  function init() {
    var active = currentModule();
    buildSidebar(active);
    startCapture(active);
    setupDropZones();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
