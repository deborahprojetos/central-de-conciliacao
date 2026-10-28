/* Central Financeira · Painel de indicadores (v2.3 · filtro por empresa) */
(function () {
  'use strict';

  var Shell = window.CentralShell;
  if (!Shell) return;
  var Store = Shell.Store;
  var $ = function (id) { return document.getElementById(id); };

  var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 2 });
  var int = new Intl.NumberFormat('pt-BR');

  var MODULE_INFO = {
    difal: { name: 'Conciliação Banco Util', tone: 'difal', mark: 'BU' },
    'itau-mvp': { name: 'Análise de pagamentos', tone: 'itau', mark: 'AP' },
    'itau-dealer': { name: 'Conciliação Cobrança', tone: 'itau', mark: 'CC' },
    cielo: { name: 'Antecipação Cielo', tone: 'cielo', mark: 'AC' }
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function plural(n, one, many) { return int.format(n) + ' ' + (n === 1 ? one : many); }
  function ago(iso) {
    if (!iso) return '';
    var d = new Date(iso), diff = (Date.now() - d.getTime()) / 1000;
    if (!isFinite(diff)) return '';
    if (diff < 60) return 'agora';
    if (diff < 3600) return 'há ' + Math.floor(diff / 60) + ' min';
    if (diff < 86400) return 'há ' + Math.floor(diff / 3600) + ' h';
    if (diff < 86400 * 7) { var n = Math.floor(diff / 86400); return 'há ' + n + (n === 1 ? ' dia' : ' dias'); }
    return d.toLocaleDateString('pt-BR');
  }
  function fullDate(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
  function toKey(br) { var m = String(br).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? Number(m[3] + m[2] + m[1]) : 0; }

  /* ---------------- Filtro ---------------- */
  var filter = Store.get('cf:filter', 'all');
  if (filter !== 'all' && !Shell.COMPANIES.some(function (c) { return c.id === filter; })) filter = 'all';
  function companiesInScope() {
    return filter === 'all' ? Shell.COMPANIES.map(function (c) { return c.id; }).concat([null]) : [filter];
  }
  function href(id, company) {
    var m = Shell.MODULES.filter(function (x) { return x.id === id; })[0];
    var base = m ? Shell.BASE + m.path : Shell.BASE;
    return company ? base + '#empresa=' + company : base;
  }

  /* ---------------- Regras de cada aplicação ---------------- */
  var SPEC = {
    difal: {
      fields: ['dates', 'analyzed', 'ok', 'div', 'miss', 'value', 'pendingDays'],
      ok: function (d) { return d.ok; },
      pending: function (d) { return d.div + d.miss; },
      value: function (d) { return d.value; },
      facts: function (d) {
        return [plural(d.miss, 'título não baixado no Dealer', 'títulos não baixados no Dealer'),
          plural(d.div, 'divergência de valor', 'divergências de valor'),
          d.analyzed + ' de ' + d.dates + ' dias conferidos'];
      },
      pend: function (d) {
        if (!(d.div + d.miss)) return '';
        return plural(d.miss, 'título não baixado no Dealer', 'títulos não baixados no Dealer') + ' · ' + plural(d.div, 'divergência', 'divergências');
      }
    },
    'itau-mvp': {
      fields: ['itauCount', 'itauValue', 'ok', 'pending', 'missing', 'dealerCount', 'dealerValue'],
      ok: function (d) { return d.ok; },
      pending: function (d) { return d.pending; },
      value: function (d) { return d.itauValue; },
      facts: function (d) { return [plural(d.itauCount, 'pagamento Itaú', 'pagamentos Itaú'), plural(d.missing, 'não localizado no Dealer', 'não localizados no Dealer')]; },
      pend: function (d) { return d.pending ? plural(d.pending, 'pendente', 'pendentes') + (d.missing ? ' · ' + plural(d.missing, 'não localizado', 'não localizados') : '') : ''; }
    },
    'itau-dealer': {
      fields: ['itauCount', 'itauValue', 'ok', 'pending', 'missing', 'review'],
      ok: function (d) { return d.ok; },
      pending: function (d) { return d.pending; },
      value: function (d) { return d.itauValue; },
      facts: function (d) {
        var f = [plural(d.itauCount, 'lançamento Itaú', 'lançamentos Itaú'), plural(d.missing, 'não localizado', 'não localizados')];
        if (d.review) f.push(plural(d.review, 'para revisão', 'para revisão'));
        return f;
      },
      pend: function (d) { return d.pending ? plural(d.pending, 'divergência', 'divergências') + (d.missing ? ' · ' + plural(d.missing, 'não localizada', 'não localizadas') : '') : ''; }
    },
    cielo: {
      fields: ['titles', 'totalClear', 'cielo04', 'noteFee', 'files'],
      ok: function () { return 0; },
      pending: function () { return 0; },
      value: function (d) { return d.totalClear; },
      facts: function (d) { return [plural(d.titles, 'título', 'títulos'), 'CIELO04 ' + brl.format(d.cielo04), 'Nota de débito ' + brl.format(d.noteFee)]; },
      pend: function () { return ''; }
    }
  };

  /* ---------------- Coleta por empresa ---------------- */
  function difalUnit(company) {
    var s = Shell.difalStateFor(company);
    if (!s) return null;
    var dates = [];
    s.bankRows.forEach(function (r) { if (r.date && dates.indexOf(r.date) === -1) dates.push(r.date); });
    if (!dates.length) return null;
    dates.sort(function (a, b) { return toKey(a) - toKey(b); });
    var d = { dates: dates.length, analyzed: 0, ok: 0, div: 0, miss: 0, value: 0, pendingDays: 0 };
    var at = '', days = [], activity = [];
    dates.forEach(function (date) {
      var a = s.analyses[date], x = a && a.summary;
      if (!x) { days.push({ date: date, state: 'none', detail: 'Ainda não conferido' }); return; }
      d.analyzed++;
      d.ok += x.exactCount || 0; d.div += x.divergenceCount || 0; d.miss += x.missingCount || 0;
      d.value += (x.bankTotalCents || 0) / 100;
      var p = (x.divergenceCount || 0) + (x.missingCount || 0);
      if (p) d.pendingDays++;
      if (a.analyzedAt > at) at = a.analyzedAt;
      days.push({ date: date, state: p ? 'pend' : 'ok', detail: plural(x.missingCount || 0, 'título não baixado', 'títulos não baixados') + ', ' + plural(x.divergenceCount || 0, 'divergência', 'divergências') });
      activity.push({ module: 'difal', company: company, at: a.analyzedAt, kind: p ? 'warn' : 'ok',
        text: 'Dia ' + date + ': ' + (p ? plural(x.missingCount || 0, 'não baixado', 'não baixados') + ', ' + plural(x.divergenceCount || 0, 'divergência', 'divergências') : 'tudo bateu') });
    });
    return { module: 'difal', company: company, at: at, d: d, days: days, activity: activity };
  }
  function snapUnit(id, company) {
    var snap = Store.get(Shell.latestKey(id, company), null);
    if (id === 'cielo') {
      var ev = Store.get(Shell.eventsKey('cielo', company), { files: 0 }) || { files: 0 };
      if (!(snap && snap.data) && !ev.files) return null;
      var c = (snap && snap.data) || {};
      return { module: 'cielo', company: company, at: ev.lastAt || (snap && snap.at) || '',
        d: { titles: c.titles || 0, totalClear: c.totalClear || 0, cielo04: c.cielo04 || 0, noteFee: c.noteFee || 0, files: ev.files || 0 },
        settlementDate: c.settlementDate };
    }
    if (!snap || !snap.data) return null;
    var d = {};
    SPEC[id].fields.forEach(function (f) { d[f] = snap.data[f] || 0; });
    return { module: id, company: company, at: snap.at, d: d };
  }

  function collect() {
    var units = [];
    companiesInScope().forEach(function (co) {
      var u = difalUnit(co); if (u) units.push(u);
      ['itau-mvp', 'itau-dealer', 'cielo'].forEach(function (id) { var x = snapUnit(id, co); if (x) units.push(x); });
    });

    var modules = {};
    units.forEach(function (u) {
      var m = modules[u.module];
      if (!m) {
        m = modules[u.module] = { units: [], d: {}, at: '' };
        SPEC[u.module].fields.forEach(function (f) { m.d[f] = 0; });
      }
      m.units.push(u);
      SPEC[u.module].fields.forEach(function (f) { m.d[f] += u.d[f] || 0; });
      if (u.at > m.at) { m.at = u.at; if (u.settlementDate) m.settlementDate = u.settlementDate; }
    });

    var activity = [];
    units.forEach(function (u) { if (u.activity) activity = activity.concat(u.activity); });
    var scope = companiesInScope();
    var log = Store.get('cf:log', []);
    if (Array.isArray(log)) {
      log.forEach(function (e) {
        if (!e || e.module === 'difal') return;
        var co = e.company || null;
        if (scope.indexOf(co) !== -1) activity.push(e);
      });
    }
    activity.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    return { units: units, modules: modules, activity: activity.slice(0, 8) };
  }

  /* ---------------- Renderização ---------------- */
  function companyTag(co) { return '<span class="co-tag">' + esc(Shell.companyName(co)) + '</span>'; }

  function renderFilter() {
    var opts = [{ id: 'all', name: 'Todas' }].concat(Shell.COMPANIES);
    $('companyFilter').innerHTML = opts.map(function (o) {
      var on = o.id === filter;
      return '<button type="button" role="radio" aria-checked="' + on + '" data-f="' + o.id + '" class="seg-btn' + (on ? ' is-on' : '') + '">' + esc(o.name) + '</button>';
    }).join('');
  }

  function render() {
    renderFilter();
    var data = collect();
    var mods = data.modules, ids = Object.keys(mods);
    var single = filter !== 'all';

    $('today').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('emptyState').hidden = ids.length > 0;
    $('emptyTitle').textContent = single ? 'Nenhuma conferência registrada para ' + Shell.companyName(filter) : 'Nenhuma conferência registrada';
    $('emptyLinks').innerHTML = Shell.MODULES.map(function (m) {
      return '<a href="' + href(m.id, single ? filter : null) + '">' + esc(MODULE_INFO[m.id].name) + '</a>';
    }).join('');

    // Indicadores principais
    var ok = 0, pend = 0, volume = 0, pendMods = 0;
    ids.forEach(function (id) {
      var spec = SPEC[id], d = mods[id].d;
      ok += spec.ok(d); pend += spec.pending(d); volume += spec.value(d);
      if (spec.pending(d)) pendMods++;
    });
    var total = ok + pend;
    $('kRate').textContent = total ? (ok / total * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '—';
    $('kOk').textContent = int.format(ok);
    $('kPend').textContent = int.format(pend);
    $('kLedgerOk').style.width = total ? (ok / total * 100) + '%' : '0%';
    $('kLedgerPend').style.width = total ? (pend / total * 100) + '%' : '0%';
    $('kLedger').setAttribute('aria-label', total ? ok + ' itens batem e ' + pend + ' estão pendentes' : 'Sem dados');
    $('kLedger').classList.toggle('is-empty', !total);

    $('kPendBig').textContent = int.format(pend);
    $('kPendBig').classList.toggle('is-alert', pend > 0);
    $('kPendSub').textContent = pend ? plural(pendMods, 'aplicação', 'aplicações') : '';

    var big = volume >= 1e5;
    $('kVolume').textContent = big ? brlCompact.format(volume) : brl.format(volume);
    $('kVolume').title = brl.format(volume);
    $('kVolumeSub').textContent = big ? brl.format(volume) : '';

    var cielo = mods.cielo;
    $('kCielo').textContent = int.format(cielo ? cielo.d.files : 0);
    $('kCieloSub').textContent = cielo && cielo.d.files ? 'Último ' + ago(cielo.at) + (cielo.settlementDate && cielo.settlementDate !== '—' ? ' · baixa ' + cielo.settlementDate : '') : '';

    // Resultado de cada aplicação
    $('moduleRows').innerHTML = Shell.MODULES.map(function (meta) {
      var id = meta.id, info = MODULE_INFO[id], m = mods[id], spec = SPEC[id];
      var link = href(id, single ? filter : null);
      var head = '<span class="mod-mark tone-' + info.tone + '">' + info.mark + '</span><div class="mod-title"><a href="' + link + '">' + esc(info.name) + '</a><small>' + (m && m.at ? 'Última conferência ' + ago(m.at) : 'Nenhuma conferência') + '</small></div>';
      var body;
      if (!m) {
        body = '';
      } else if (id === 'cielo') {
        body = '<div class="mod-body"><div class="mod-figure"><strong>' + brl.format(m.d.totalClear) + '</strong><span>a baixar no Dealer</span></div><p class="mod-facts">' + spec.facts(m.d).map(esc).join('<span class="sep"></span>') + '</p>' + byCompany(m, id) + '</div>';
      } else {
        var o = spec.ok(m.d), p = spec.pending(m.d), t = o + p, pct = t ? Math.round(o / t * 100) : 0;
        body = '<div class="mod-body"><div class="mod-bar" role="img" aria-label="' + pct + '% fechado"><span class="ledger-ok" style="width:' + (t ? o / t * 100 : 0) + '%"></span><span class="ledger-pend" style="width:' + (t ? p / t * 100 : 0) + '%"></span></div>' +
          '<div class="mod-nums"><span><b>' + int.format(o) + '</b> batem</span><span class="' + (p ? 'is-alert' : '') + '"><b>' + int.format(p) + '</b> pendentes</span><span class="mod-pct">' + pct + '% fechado</span></div>' +
          '<p class="mod-facts">' + spec.facts(m.d).map(esc).join('<span class="sep"></span>') + '</p>' + byCompany(m, id) + '</div>';
      }
      return '<article class="mod-row' + (m ? '' : ' is-empty') + '"><div class="mod-head">' + head + '<a class="dash-link" href="' + link + '">Abrir</a></div>' + body + '</article>';
    }).join('');

    // O que precisa de atenção (por empresa)
    var pendUnits = data.units.filter(function (u) { return SPEC[u.module].pending(u.d) > 0; })
      .sort(function (a, b) { return SPEC[b.module].pending(b.d) - SPEC[a.module].pending(a.d); });
    $('pendList').innerHTML = pendUnits.length ? pendUnits.map(function (u) {
      var n = SPEC[u.module].pending(u.d);
      return '<li><a href="' + href(u.module, u.company) + '"><span class="pend-count">' + int.format(n) + '</span><span><strong>' + esc(MODULE_INFO[u.module].name) + (single ? '' : ' ' + companyTag(u.company)) + '</strong><small>' + esc(SPEC[u.module].pend(u.d)) + '</small></span></a></li>';
    }).join('') : '<li class="list-empty">' + (ids.length ? 'Nada pendente.' : '—') + '</li>';

    // Últimas conferências
    $('activity').innerHTML = data.activity.length ? data.activity.map(function (e) {
      var info = MODULE_INFO[e.module] || { name: e.module };
      return '<li class="act-' + (e.kind === 'warn' ? 'warn' : 'ok') + '"><span class="act-dot"></span><div><strong>' + esc(info.name) + (single ? '' : ' ' + companyTag(e.company || null)) + '</strong><span>' + esc(e.text) + '</span></div><time datetime="' + esc(e.at) + '" title="' + esc(fullDate(e.at)) + '">' + esc(ago(e.at)) + '</time></li>';
    }).join('') : '<li class="list-empty">—</li>';

    // Dias conferidos · Banco Util (uma faixa por empresa)
    var difalUnits = data.units.filter(function (u) { return u.module === 'difal'; });
    $('difalPeriod').hidden = !difalUnits.length;
    $('dayStrips').innerHTML = difalUnits.map(function (u) {
      return '<div class="day-group"><div class="day-group-head"><strong>' + esc(single ? 'Período' : Shell.companyName(u.company)) + '</strong><span>' + u.d.analyzed + ' de ' + u.d.dates + ' dias · ' + plural(u.d.miss, 'título não baixado', 'títulos não baixados') + '</span><a class="dash-link" href="' + href('difal', u.company) + '">Abrir</a></div>' +
        '<div class="day-strip">' + u.days.map(function (d) {
          var parts = d.date.split('/');
          return '<a class="day day-' + d.state + '" href="' + href('difal', u.company) + '" title="' + esc(d.date + ': ' + d.detail) + '"><b>' + esc(parts[0]) + '</b><span>' + esc(parts[1] || '') + '</span></a>';
        }).join('') + '</div></div>';
    }).join('');
  }

  // Na visão "Todas": quanto cada empresa tem naquela aplicação.
  function byCompany(m, id) {
    if (filter !== 'all' || m.units.length < 2) return '';
    var spec = SPEC[id];
    return '<p class="mod-split">' + m.units.map(function (u) {
      var label = id === 'cielo' ? plural(u.d.files, 'arquivo', 'arquivos') : plural(spec.pending(u.d), 'pendente', 'pendentes');
      return '<a href="' + href(id, u.company) + '">' + companyTag(u.company) + ' ' + esc(label) + '</a>';
    }).join('') + '</p>';
  }

  $('companyFilter').addEventListener('click', function (e) {
    var b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.getAttribute('data-f');
    Store.set('cf:filter', filter);
    render();
  });
  $('refreshBtn').addEventListener('click', render);
  $('clearIndicators').addEventListener('click', function () {
    if (!window.confirm('Limpar os indicadores do painel? Os períodos da Conciliação Banco Util não serão apagados.')) return;
    try {
      Object.keys(localStorage).forEach(function (k) {
        if ((k.indexOf('cf:latest:') === 0) || (k.indexOf('cf:events:') === 0) || k === 'cf:log') localStorage.removeItem(k);
      });
    } catch (e) {}
    render();
  });
  window.addEventListener('storage', render);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); });
  render();
})();
