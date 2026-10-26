/* Central Financeira · Painel de indicadores (v2.0) */
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
    difal: { name: 'DIFAL · Banco Util × Dealer', tone: 'difal', mark: 'DF' },
    'itau-mvp': { name: 'Itaú · Pagamentos', tone: 'itau', mark: 'IP' },
    'itau-dealer': { name: 'Itaú · Recebimentos e pagamentos', tone: 'itau', mark: 'IC' },
    cielo: { name: 'Gerador CIELO04', tone: 'cielo', mark: 'C04' }
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function href(id) {
    var m = Shell.MODULES.filter(function (x) { return x.id === id; })[0];
    return m ? Shell.BASE + m.path : Shell.BASE;
  }
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
  function fullDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }
  function plural(n, one, many) { return int.format(n) + ' ' + (n === 1 ? one : many); }

  /* ---------------- Coleta ---------------- */
  function collect() {
    var out = { modules: {}, activity: [], days: [] };

    // DIFAL: lido diretamente do histórico salvo pela própria aplicação.
    var ds = Shell.difalState();
    if (ds) {
      var dates = [];
      ds.bankRows.forEach(function (r) { if (r.date && dates.indexOf(r.date) === -1) dates.push(r.date); });
      dates.sort(function (a, b) { return toKey(a) - toKey(b); });
      var ok = 0, div = 0, miss = 0, extra = 0, value = 0, lastAt = '', analyzed = 0, pendingDays = 0;
      dates.forEach(function (date) {
        var a = ds.analyses[date];
        var s = a && a.summary;
        if (s) {
          analyzed++;
          ok += s.exactCount || 0; div += s.divergenceCount || 0; miss += s.missingCount || 0; extra += s.extraDealerCount || 0;
          value += (s.bankTotalCents || 0) / 100;
          var p = (s.divergenceCount || 0) + (s.missingCount || 0);
          if (p) pendingDays++;
          if (a.analyzedAt > lastAt) lastAt = a.analyzedAt;
          out.activity.push({ module: 'difal', at: a.analyzedAt, kind: p ? 'warn' : 'ok', text: 'Dia ' + date + ': ' + (p ? plural(p, 'pendência', 'pendências') : 'sem pendências') });
          out.days.push({ date: date, state: p ? 'pend' : 'ok', detail: plural(s.exactCount || 0, 'OK', 'OK') + ', ' + plural(s.divergenceCount || 0, 'divergência', 'divergências') + ', ' + plural(s.missingCount || 0, 'sem baixa no Dealer', 'sem baixa no Dealer') });
        } else {
          out.days.push({ date: date, state: 'none', detail: 'Ainda não analisada' });
        }
      });
      if (dates.length) {
        out.modules.difal = {
          at: lastAt, ok: ok, pending: div + miss, value: value,
          facts: [analyzed + ' de ' + dates.length + ' datas analisadas', plural(div, 'divergência', 'divergências'), plural(miss, 'documento sem baixa', 'documentos sem baixa')],
          pendText: div + miss ? plural(div, 'divergência', 'divergências') + ' e ' + plural(miss, 'documento sem baixa no Dealer', 'documentos sem baixa no Dealer') + ' em ' + plural(pendingDays, 'data', 'datas') : '',
          dates: dates.length, analyzed: analyzed, pendingDays: pendingDays
        };
      }
    }

    ['itau-mvp', 'itau-dealer'].forEach(function (id) {
      var snap = Store.get('cf:latest:' + id, null);
      if (!snap || !snap.data) return;
      var d = snap.data;
      var facts = [plural(d.itauCount || 0, 'lançamento Itaú', 'lançamentos Itaú'), plural(d.missing || 0, 'não localizado', 'não localizados')];
      if (id === 'itau-dealer' && d.review) facts.push(plural(d.review, 'para revisão', 'para revisão'));
      out.modules[id] = {
        at: snap.at, ok: d.ok || 0, pending: d.pending || 0, value: d.itauValue || 0, facts: facts,
        pendText: d.pending ? (id === 'itau-mvp' ? plural(d.pending, 'pendência', 'pendências') : plural(d.pending, 'divergência', 'divergências')) + (d.missing ? ', das quais ' + plural(d.missing, 'não localizada', 'não localizadas') : '') : ''
      };
    });

    var c = Store.get('cf:latest:cielo', null);
    var ce = Store.get('cf:events:cielo', { files: 0 });
    if (c && c.data) {
      out.modules.cielo = {
        at: (ce && ce.lastAt) || c.at, value: c.data.totalClear || 0, files: ce.files || 0,
        facts: [plural(c.data.titles || 0, 'título', 'títulos'), 'CIELO04 ' + brl.format(c.data.cielo04 || 0), 'Nota de débito ' + brl.format(c.data.noteFee || 0)],
        settlementDate: c.data.settlementDate
      };
    }

    var log = Store.get('cf:log', []);
    if (Array.isArray(log)) out.activity = out.activity.concat(log.filter(function (e) { return e.module !== 'difal'; }));
    out.activity.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    out.activity = out.activity.slice(0, 8);
    return out;
  }

  function toKey(br) {
    var m = String(br).match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? Number(m[3] + m[2] + m[1]) : 0;
  }

  /* ---------------- Renderização ---------------- */
  function render() {
    var data = collect();
    var mods = data.modules;
    var ids = Object.keys(mods);

    $('today').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('emptyState').hidden = ids.length > 0;
    $('emptyLinks').innerHTML = Shell.MODULES.map(function (m) {
      return '<a href="' + Shell.BASE + m.path + '">' + esc(MODULE_INFO[m.id].name) + '</a>';
    }).join('');

    // Indicadores principais
    var ok = 0, pend = 0, volume = 0, pendMods = 0;
    ids.forEach(function (id) {
      var m = mods[id];
      ok += m.ok || 0; pend += m.pending || 0; volume += m.value || 0;
      if (m.pending) pendMods++;
    });
    var total = ok + pend;
    var rate = total ? ok / total : null;
    $('kRate').textContent = rate == null ? '—' : (rate * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
    $('kOk').textContent = int.format(ok);
    $('kPend').textContent = int.format(pend);
    $('kLedgerOk').style.width = total ? (ok / total * 100) + '%' : '0%';
    $('kLedgerPend').style.width = total ? (pend / total * 100) + '%' : '0%';
    $('kLedger').setAttribute('aria-label', total ? ok + ' conciliados e ' + pend + ' pendências' : 'Sem dados');
    $('kLedger').classList.toggle('is-empty', !total);

    $('kPendBig').textContent = int.format(pend);
    $('kPendBig').classList.toggle('is-alert', pend > 0);
    $('kPendSub').textContent = pend ? 'Em ' + plural(pendMods, 'aplicação', 'aplicações') : 'Nenhuma pendência registrada';
    var big = volume >= 1e5;
    $('kVolume').textContent = big ? brlCompact.format(volume) : brl.format(volume);
    $('kVolume').title = brl.format(volume);
    $('kVolumeSub').textContent = big ? brl.format(volume) + ' somando a última análise de cada aplicação e o período DIFAL' : 'Última análise de cada aplicação e período DIFAL';

    var cielo = mods.cielo;
    $('kCielo').textContent = int.format(cielo ? cielo.files : 0);
    $('kCieloSub').textContent = cielo && cielo.files ? 'Último ' + ago(cielo.at) + (cielo.settlementDate && cielo.settlementDate !== '—' ? ', baixa em ' + cielo.settlementDate : '') : 'Nenhum arquivo gerado';

    // Situação por aplicação
    $('moduleRows').innerHTML = Shell.MODULES.map(function (meta) {
      var id = meta.id, info = MODULE_INFO[id], m = mods[id];
      var head = '<span class="mod-mark tone-' + info.tone + '">' + info.mark + '</span><div class="mod-title"><a href="' + href(id) + '">' + esc(info.name) + '</a><small>' + (m && m.at ? 'Última análise ' + ago(m.at) : 'Nenhuma análise registrada') + '</small></div>';
      var body;
      if (!m) {
        body = '<div class="mod-body mod-body-empty"><span>' + (id === 'cielo' ? 'Analise uma planilha Cielo para ver o lote aqui.' : 'Conclua uma conferência para ver o resultado aqui.') + '</span></div>';
      } else if (id === 'cielo') {
        body = '<div class="mod-body"><div class="mod-figure"><strong>' + brl.format(m.value) + '</strong><span>a baixar no Dealer</span></div><p class="mod-facts">' + m.facts.map(esc).join('<span class="sep"></span>') + '</p></div>';
      } else {
        var t = m.ok + m.pending, pct = t ? Math.round(m.ok / t * 100) : 0;
        body = '<div class="mod-body"><div class="mod-bar" role="img" aria-label="' + pct + '% conciliado"><span class="ledger-ok" style="width:' + (t ? m.ok / t * 100 : 0) + '%"></span><span class="ledger-pend" style="width:' + (t ? m.pending / t * 100 : 0) + '%"></span></div>' +
          '<div class="mod-nums"><span><b>' + int.format(m.ok) + '</b> conciliados</span><span class="' + (m.pending ? 'is-alert' : '') + '"><b>' + int.format(m.pending) + '</b> pendências</span><span class="mod-pct">' + pct + '%</span></div>' +
          '<p class="mod-facts">' + m.facts.map(esc).join('<span class="sep"></span>') + '</p></div>';
      }
      return '<article class="mod-row">' + '<div class="mod-head">' + head + '<a class="dash-link" href="' + href(id) + '">Abrir</a></div>' + body + '</article>';
    }).join('');

    // Pendências a tratar
    var pendItems = ids.filter(function (id) { return mods[id].pendText; }).sort(function (a, b) { return mods[b].pending - mods[a].pending; });
    $('pendList').innerHTML = pendItems.length ? pendItems.map(function (id) {
      return '<li><a href="' + href(id) + '"><span class="pend-count">' + int.format(mods[id].pending) + '</span><span><strong>' + esc(MODULE_INFO[id].name) + '</strong><small>' + esc(mods[id].pendText) + '</small></span></a></li>';
    }).join('') : '<li class="list-empty">' + (ids.length ? 'Tudo conciliado nas últimas análises.' : 'Sem análises para avaliar.') + '</li>';

    // Atividade
    $('activity').innerHTML = data.activity.length ? data.activity.map(function (e) {
      var info = MODULE_INFO[e.module] || { name: e.module };
      return '<li class="act-' + (e.kind === 'warn' ? 'warn' : 'ok') + '"><span class="act-dot"></span><div><strong>' + esc(info.name) + '</strong><span>' + esc(e.text) + '</span></div><time datetime="' + esc(e.at) + '" title="' + esc(fullDate(e.at)) + '">' + esc(ago(e.at)) + '</time></li>';
    }).join('') : '<li class="list-empty">As conferências concluídas aparecem aqui.</li>';

    // Período DIFAL
    var dm = mods.difal;
    $('difalPeriod').hidden = !dm;
    if (dm) {
      $('difalSub').textContent = dm.analyzed + ' de ' + dm.dates + ' datas analisadas' + (dm.pendingDays ? ', ' + plural(dm.pendingDays, 'com pendências', 'com pendências') : '');
      $('dayStrip').innerHTML = data.days.map(function (d) {
        var parts = d.date.split('/');
        return '<a class="day day-' + d.state + '" href="' + href('difal') + '" title="' + esc(d.date + ': ' + d.detail) + '"><b>' + esc(parts[0]) + '</b><span>' + esc(parts[1] || '') + '</span></a>';
      }).join('');
    }
  }

  $('refreshBtn').addEventListener('click', render);
  $('clearIndicators').addEventListener('click', function () {
    if (!window.confirm('Limpar os indicadores do painel? O histórico salvo dentro do DIFAL não será apagado.')) return;
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('cf:') === 0 && k !== 'cf:sidebar') localStorage.removeItem(k); });
    } catch (e) {}
    render();
  });
  window.addEventListener('storage', render);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); });
  render();
})();
