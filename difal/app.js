(() => {
  'use strict';

  const STORAGE_KEY = 'difal_conciliacao_final_1_0';
  const Core = window.DifalCore;
  const $ = (id) => document.getElementById(id);

  const els = {
    bankFile: $('bankFile'), bankStatusBadge: $('bankStatusBadge'), bankMeta: $('bankMeta'),
    metaFile: $('metaFile'), metaSheet: $('metaSheet'), metaRows: $('metaRows'), metaPeriod: $('metaPeriod'),
    metaIgnored: $('metaIgnored'), metaAnalyzed: $('metaAnalyzed'), metaImportedAt: $('metaImportedAt'), bankError: $('bankError'),
    bankOriginNotice: $('bankOriginNotice'), bankOriginBadge: $('bankOriginBadge'), bankOriginText: $('bankOriginText'), bankPeriodHelper: $('bankPeriodHelper'),
    analysisDate: $('analysisDate'), emptyDealerCheck: $('emptyDealerCheck'), dealerText: $('dealerText'),
    dealerParsedInfo: $('dealerParsedInfo'), dealerStatusBadge: $('dealerStatusBadge'), dealerWarning: $('dealerWarning'),
    rejectedDetails: $('rejectedDetails'), rejectedLines: $('rejectedLines'), dealerError: $('dealerError'),
    analyzeBtn: $('analyzeBtn'), clearDealerBtn: $('clearDealerBtn'), deleteDateBtn: $('deleteDateBtn'),
    resultSection: $('resultSection'), resultDate: $('resultDate'), resultTimestamp: $('resultTimestamp'),
    kpiBankCount: $('kpiBankCount'), kpiBankTotal: $('kpiBankTotal'), kpiDealerCount: $('kpiDealerCount'),
    kpiDealerTotal: $('kpiDealerTotal'), kpiOk: $('kpiOk'), kpiDivergence: $('kpiDivergence'),
    kpiDivergenceValue: $('kpiDivergenceValue'), kpiMissing: $('kpiMissing'), kpiMissingTotal: $('kpiMissingTotal'),
    totalNetDifference: $('totalNetDifference'), extraDealerCount: $('extraDealerCount'), parserRejectedCount: $('parserRejectedCount'),
    differencesBody: $('differencesBody'), differencesFoot: $('differencesFoot'), noDifferences: $('noDifferences'),
    missingDocuments: $('missingDocuments'), missingCountBadge: $('missingCountBadge'), extraDealerList: $('extraDealerList'),
    extraCountBadge: $('extraCountBadge'), copyMissingBtn: $('copyMissingBtn'), exportBtn: $('exportBtn'),
    historySection: $('historySection'), historyBody: $('historyBody'), exportPeriodBtn: $('exportPeriodBtn'),
    backupBtn: $('backupBtn'), restoreInput: $('restoreInput'), resetBtn: $('resetBtn'),
    progressText: $('progressText'), progressPercent: $('progressPercent'), progressBar: $('progressBar'), toast: $('toast'),
  };

  let state = loadState();
  let bankRuntimeSource = state.bankRows.length ? 'restored' : 'none';
  let activeFilter = 'ALL';
  let currentParsedDealer = { rows: [], rejected: [], inputLineCount: 0, headerCount: 0 };
  let currentAnalysis = null;

  function defaultState() {
    return {
      schema: 'DIFAL_FINAL_1_0',
      bankFileName: '', bankSheetName: '', bankRows: [], ignoredBankRows: 0,
      analyses: {}, lastDate: '', importedAt: '',
    };
  }

  function isValidState(obj) {
    return obj && obj.schema === 'DIFAL_FINAL_1_0' && Array.isArray(obj.bankRows) && obj.analyses && typeof obj.analyses === 'object';
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return isValidState(parsed) ? { ...defaultState(), ...parsed } : defaultState();
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      toast('Não foi possível salvar o histórico no navegador. Exporte um backup.', 'error');
      return false;
    }
  }

  function toast(message, kind = 'normal') {
    els.toast.textContent = message;
    els.toast.classList.toggle('error', kind === 'error');
    els.toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => els.toast.classList.remove('show'), 2800);
  }

  function showMessage(el, message) { el.textContent = message; el.classList.remove('hidden'); }
  function hideMessage(el) { el.textContent = ''; el.classList.add('hidden'); }
  function setBadge(el, text, kind = 'neutral') { el.textContent = text; el.className = `badge ${kind}`; }
  function formatInteger(value) { return Number(value || 0).toLocaleString('pt-BR'); }

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function getUniqueDates() {
    return [...new Set(state.bankRows.map((r) => r.date).filter(Boolean))]
      .sort((a, b) => Core.dateSortKey(a).localeCompare(Core.dateSortKey(b)));
  }

  function formatPeriod(dates) {
    if (!dates.length) return '—';
    return dates.length === 1 ? dates[0] : `${dates[0]} a ${dates[dates.length - 1]}`;
  }

  function buildBankRowsFromWorksheet(ws) {
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    if (!matrix.length) throw new Error('A planilha está vazia.');

    let headerIndex = -1;
    let columns = null;
    for (let i = 0; i < Math.min(matrix.length, 30); i += 1) {
      const normalized = matrix[i].map(Core.normalizeText);
      const dateIdx = normalized.findIndex((h) => h.includes('data do pagamento'));
      const docIdx = normalized.findIndex((h) => h.includes('n do documento') || h.includes('numero do documento'));
      const valueIdx = normalized.findIndex((h) => h === 'valor total' || h.includes('valor total'));
      if (dateIdx < 0 || docIdx < 0 || valueIdx < 0) continue;
      headerIndex = i;
      columns = {
        dateIdx, docIdx, valueIdx,
        typeIdx: normalized.findIndex((h) => h.includes('tipo do lancamento')),
        statusIdx: normalized.findIndex((h) => h === 'status' || h.startsWith('status ')),
      };
      break;
    }

    if (headerIndex < 0) throw new Error('Não encontrei as colunas: Data do pagamento, Nº do documento e Valor total.');

    const rows = [];
    let ignored = 0;
    for (let i = headerIndex + 1; i < matrix.length; i += 1) {
      const row = matrix[i];
      if (!row || row.every((v) => String(v || '').trim() === '')) continue;

      const date = Core.normalizeDate(row[columns.dateIdx]);
      const document = Core.normalizeDocument(row[columns.docIdx]);
      const valueCents = Core.parseMoney(row[columns.valueIdx]);
      const type = columns.typeIdx >= 0 ? Core.normalizeText(row[columns.typeIdx]) : '';
      const status = columns.statusIdx >= 0 ? Core.normalizeText(row[columns.statusIdx]) : '';

      if (type && type !== 'pagamento') { ignored += 1; continue; }
      if (status && status !== 'efetivado') { ignored += 1; continue; }
      if (!date || !document || valueCents === null) { ignored += 1; continue; }

      rows.push({ id: `bank-${i + 1}`, sourceRow: i + 1, date, document, valueCents });
    }

    if (!rows.length) throw new Error('Nenhum pagamento válido foi encontrado na planilha.');
    return { rows, ignored };
  }

  async function handleBankFile(file) {
    hideMessage(els.bankError);
    if (!window.XLSX) {
      showMessage(els.bankError, 'O componente de leitura de Excel não carregou. Atualize a página e tente novamente.');
      return;
    }

    if (state.bankRows.length) {
      const ok = window.confirm('Substituir a planilha atual apagará as análises salvas deste período. Deseja continuar?');
      if (!ok) { els.bankFile.value = ''; return; }
    }

    try {
      setBadge(els.bankStatusBadge, 'Lendo...', 'warning');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      if (!workbook.SheetNames.length) throw new Error('O arquivo não possui abas.');

      let best = null;
      let selected = '';
      for (const sheetName of workbook.SheetNames) {
        try {
          const parsed = buildBankRowsFromWorksheet(workbook.Sheets[sheetName]);
          if (!best || parsed.rows.length > best.rows.length) { best = parsed; selected = sheetName; }
        } catch { /* tenta a próxima aba */ }
      }
      if (!best) throw new Error('Nenhuma aba possui a estrutura esperada do Banco Util.');

      state = defaultState();
      state.bankFileName = file.name;
      state.bankSheetName = selected;
      state.bankRows = best.rows;
      state.ignoredBankRows = best.ignored;
      state.importedAt = new Date().toISOString();
      state.lastDate = [...new Set(best.rows.map((r) => r.date))].sort((a, b) => Core.dateSortKey(a).localeCompare(Core.dateSortKey(b)))[0] || '';
      bankRuntimeSource = 'imported';
      saveState();

      currentAnalysis = null;
      els.dealerText.value = '';
      els.emptyDealerCheck.checked = false;
      renderAll();
      toast(`${formatInteger(best.rows.length)} pagamentos válidos carregados.`);
    } catch (err) {
      setBadge(els.bankStatusBadge, 'Erro', 'danger');
      showMessage(els.bankError, err.message || 'Não foi possível ler a planilha.');
    }
  }

  function populateDateSelect() {
    const dates = getUniqueDates();
    els.analysisDate.innerHTML = '';
    if (!dates.length) {
      els.analysisDate.disabled = true;
      els.analysisDate.innerHTML = '<option value="">Carregue primeiro a planilha</option>';
      return;
    }

    dates.forEach((date) => {
      const option = document.createElement('option');
      const bankCount = state.bankRows.filter((r) => r.date === date).length;
      const analysis = state.analyses[date];
      option.value = date;
      option.textContent = `${date} — ${bankCount} doc${bankCount === 1 ? '' : 's'}${analysis ? ' — analisado' : ''}`;
      els.analysisDate.appendChild(option);
    });

    const preferred = dates.includes(state.lastDate) ? state.lastDate : dates[0];
    els.analysisDate.value = preferred;
    els.analysisDate.disabled = false;
  }

  function renderBankMeta() {
    const dates = getUniqueDates();
    if (!state.bankRows.length) {
      els.bankMeta.classList.add('hidden');
      els.bankOriginNotice.classList.add('hidden');
      els.bankPeriodHelper.classList.add('hidden');
      setBadge(els.bankStatusBadge, 'Sem arquivo', 'neutral');
      return;
    }

    els.bankMeta.classList.remove('hidden');
    els.bankOriginNotice.classList.remove('hidden');
    els.bankPeriodHelper.classList.remove('hidden');
    els.metaFile.textContent = state.bankFileName || 'Base salva';
    els.metaSheet.textContent = state.bankSheetName || '—';
    els.metaRows.textContent = formatInteger(state.bankRows.length);
    els.metaPeriod.textContent = formatPeriod(dates);
    els.metaPeriod.title = formatPeriod(dates);
    els.metaIgnored.textContent = formatInteger(state.ignoredBankRows || 0);
    const analyzedCount = Object.keys(state.analyses).filter((date) => dates.includes(date)).length;
    els.metaAnalyzed.textContent = `${analyzedCount} de ${dates.length} data${dates.length === 1 ? '' : 's'}`;
    els.metaImportedAt.textContent = formatDateTime(state.importedAt);

    if (bankRuntimeSource === 'imported') {
      setBadge(els.bankOriginBadge, 'PLANILHA CARREGADA AGORA', 'success');
      els.bankOriginText.textContent = 'Os números exibidos abaixo foram recalculados a partir do arquivo que você acabou de selecionar.';
    } else if (bankRuntimeSource === 'backup') {
      setBadge(els.bankOriginBadge, 'BACKUP RESTAURADO', 'warning');
      els.bankOriginText.textContent = 'A base e as análises abaixo vieram do arquivo de backup restaurado nesta sessão.';
    } else {
      setBadge(els.bankOriginBadge, 'BASE RESTAURADA DO NAVEGADOR', 'neutral');
      els.bankOriginText.textContent = 'Esta base foi recuperada automaticamente do último período salvo neste navegador. Selecione outra planilha para trocar o período.';
    }

    setBadge(els.bankStatusBadge, bankRuntimeSource === 'restored' ? 'Base restaurada' : 'Base carregada', bankRuntimeSource === 'restored' ? 'neutral' : 'success');
  }

  function updateDealerPreview() {
    hideMessage(els.dealerError);
    hideMessage(els.dealerWarning);
    els.rejectedDetails.classList.add('hidden');
    els.rejectedLines.textContent = '';

    const selectedDate = els.analysisDate.value;
    const emptyDealer = els.emptyDealerCheck.checked;
    els.dealerText.disabled = emptyDealer;

    if (emptyDealer) {
      currentParsedDealer = { rows: [], rejected: [], inputLineCount: 0, headerCount: 0 };
      els.dealerParsedInfo.textContent = 'Dia confirmado sem lançamentos';
      setBadge(els.dealerStatusBadge, 'Dealer vazio', 'warning');
      els.analyzeBtn.disabled = !(state.bankRows.length && selectedDate);
      return;
    }

    currentParsedDealer = Core.parseDealerText(els.dealerText.value, selectedDate);
    const inDate = currentParsedDealer.rows.filter((r) => r.date === selectedDate).length;
    const otherDates = currentParsedDealer.rows.length - inDate;
    const rejected = currentParsedDealer.rejected.length;

    let label = `${formatInteger(inDate)} reconhecida${inDate === 1 ? '' : 's'}`;
    if (otherDates) label += ` • ${formatInteger(otherDates)} outra data`;
    if (rejected) label += ` • ${formatInteger(rejected)} ignorada${rejected === 1 ? '' : 's'}`;
    els.dealerParsedInfo.textContent = label;

    if (rejected) {
      showMessage(els.dealerWarning, `${rejected} linha${rejected === 1 ? '' : 's'} do texto não ${rejected === 1 ? 'foi reconhecida' : 'foram reconhecidas'}. Confira antes de concluir a análise.`);
      els.rejectedDetails.classList.remove('hidden');
      els.rejectedLines.textContent = currentParsedDealer.rejected.map((r) => `Linha ${r.line}: ${r.raw}`).join('\n');
    }

    if (inDate > 0) setBadge(els.dealerStatusBadge, `${inDate} registros`, rejected ? 'warning' : 'success');
    else if (els.dealerText.value.trim()) setBadge(els.dealerStatusBadge, 'Não reconhecido', 'danger');
    else setBadge(els.dealerStatusBadge, 'Aguardando', 'neutral');

    els.analyzeBtn.disabled = !(state.bankRows.length && selectedDate && inDate > 0);
  }

  function analyzeCurrentDate() {
    hideMessage(els.dealerError);
    const date = els.analysisDate.value;
    if (!date) return;

    const bankForDate = state.bankRows.filter((r) => r.date === date);
    if (!bankForDate.length) { showMessage(els.dealerError, `Não há registros do Banco Util em ${date}.`); return; }

    let dealerRows = [];
    let rejectedCount = 0;
    const dealerConfirmedEmpty = els.emptyDealerCheck.checked;

    if (dealerConfirmedEmpty) {
      const ok = window.confirm(`Você confirmou que o Dealer não possui lançamentos em ${date}. Os ${bankForDate.length} registros do Banco Util serão marcados como DEALER. Continuar?`);
      if (!ok) return;
    } else {
      currentParsedDealer = Core.parseDealerText(els.dealerText.value, date);
      dealerRows = currentParsedDealer.rows;
      rejectedCount = currentParsedDealer.rejected.length;
      const inDate = dealerRows.filter((r) => r.date === date);
      if (!inDate.length) { showMessage(els.dealerError, `Nenhuma linha válida do Dealer foi identificada para ${date}.`); return; }
      if (rejectedCount) {
        const ok = window.confirm(`Há ${rejectedCount} linha(s) do Dealer não reconhecida(s). Se alguma delas for um lançamento, o resultado pode ficar incompleto. Deseja analisar mesmo assim?`);
        if (!ok) return;
      }
    }

    const analysis = Core.reconcileDay(state.bankRows, dealerRows, date);
    const record = {
      ...analysis,
      dealerRows: dealerRows.filter((r) => r.date === date).map(({ id, sourceLine, date: d, document, parcel, valueCents }) => ({ id, sourceLine, date: d, document, parcel, valueCents })),
      analyzedAt: new Date().toISOString(), parserRejectedCount: rejectedCount, dealerConfirmedEmpty,
    };

    state.analyses[date] = record;
    state.lastDate = date;
    saveState();
    currentAnalysis = record;
    renderAll();
    els.analysisDate.value = date;
    toast(`Conferência de ${date} salva.`);
  }

  function analysisForDate(date) { return state.analyses[date] || null; }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function statusChip(status) {
    if (status === 'DEALER') return '<span class="status-chip dealer">DEALER</span>';
    if (status === 'DIVERGENCIA' || status === 'DIVERGÊNCIA') return '<span class="status-chip divergence">DIVERGÊNCIA</span>';
    if (status === 'OK') return '<span class="status-chip ok">OK</span>';
    return '<span class="status-chip pending">NÃO ANALISADO</span>';
  }

  function renderCurrentAnalysis() {
    const date = els.analysisDate.value || state.lastDate;
    const analysis = currentAnalysis && currentAnalysis.date === date ? currentAnalysis : analysisForDate(date);
    els.deleteDateBtn.classList.toggle('hidden', !analysis);

    if (!analysis) { els.resultSection.classList.add('hidden'); currentAnalysis = null; return; }
    currentAnalysis = analysis;
    const s = analysis.summary;
    els.resultSection.classList.remove('hidden');
    els.resultDate.textContent = analysis.date;
    els.resultTimestamp.textContent = `Última análise: ${formatDateTime(analysis.analyzedAt)}${analysis.dealerConfirmedEmpty ? ' • Dealer confirmado vazio' : ''}`;
    els.kpiBankCount.textContent = formatInteger(s.bankCount);
    els.kpiBankTotal.textContent = Core.formatMoney(s.bankTotalCents);
    els.kpiDealerCount.textContent = formatInteger(s.dealerCount);
    els.kpiDealerTotal.textContent = Core.formatMoney(s.dealerTotalCents);
    els.kpiOk.textContent = formatInteger(s.exactCount);
    els.kpiDivergence.textContent = formatInteger(s.divergenceCount);
    els.kpiDivergenceValue.textContent = Core.formatMoney(s.divergenceNetCents);
    els.kpiMissing.textContent = formatInteger(s.missingCount);
    els.kpiMissingTotal.textContent = `${Core.formatMoney(s.missingTotalCents)} pendente`;
    els.totalNetDifference.textContent = Core.formatMoney(s.totalNetDifferenceCents);
    els.extraDealerCount.textContent = formatInteger(s.extraDealerCount);
    els.parserRejectedCount.textContent = formatInteger(analysis.parserRejectedCount || 0);
    renderDifferences(); renderMissing(); renderExtras();
  }

  function renderDifferences() {
    if (!currentAnalysis) return;
    let rows = currentAnalysis.results.filter((r) => r.status !== 'OK');
    if (activeFilter !== 'ALL') rows = rows.filter((r) => r.status === activeFilter);

    els.differencesBody.innerHTML = '';
    els.differencesFoot.innerHTML = '';
    els.noDifferences.classList.toggle('hidden', rows.length > 0);

    let bankTotal = 0, dealerTotal = 0, differenceTotal = 0;
    rows.forEach((row) => {
      bankTotal += row.bankValueCents || 0;
      dealerTotal += row.dealerValueCents || 0;
      if (row.differenceCents !== null) differenceTotal += row.differenceCents || 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(row.date)}</td><td><strong>${escapeHtml(row.document)}</strong></td><td class="right">${Core.formatMoney(row.bankValueCents)}</td><td class="right">${Core.formatMoney(row.dealerValueCents)}</td><td class="right">${row.differenceCents === null ? '—' : Core.formatMoney(row.differenceCents)}</td><td>${statusChip(row.status)}</td>`;
      els.differencesBody.appendChild(tr);
    });

    if (rows.length) {
      els.differencesFoot.innerHTML = `<tr><td colspan="2">Total exibido</td><td class="right">${Core.formatMoney(bankTotal)}</td><td class="right">${Core.formatMoney(dealerTotal)}</td><td class="right">${Core.formatMoney(differenceTotal)}</td><td>${formatInteger(rows.length)} registro(s)</td></tr>`;
    }
  }

  function renderMissing() {
    const rows = currentAnalysis ? currentAnalysis.results.filter((r) => r.status === 'DEALER') : [];
    els.missingCountBadge.textContent = formatInteger(rows.length);
    els.copyMissingBtn.disabled = rows.length === 0;
    els.missingDocuments.innerHTML = rows.length ? '' : '<div class="document-empty">Nenhum documento pendente no Dealer.</div>';
    rows.forEach((row) => {
      const item = document.createElement('div'); item.className = 'document-row';
      item.innerHTML = `<strong>${escapeHtml(row.document)}</strong><span>${Core.formatMoney(row.bankValueCents)}</span>`;
      els.missingDocuments.appendChild(item);
    });
  }

  function renderExtras() {
    const rows = currentAnalysis ? currentAnalysis.extras || [] : [];
    els.extraCountBadge.textContent = formatInteger(rows.length);
    els.extraDealerList.innerHTML = rows.length ? '' : '<div class="document-empty">Nenhum lançamento extra identificado.</div>';
    rows.forEach((row) => {
      const item = document.createElement('div'); item.className = 'document-row';
      item.innerHTML = `<strong>${escapeHtml(row.document)}</strong><span>${Core.formatMoney(row.dealerValueCents)}</span>`;
      els.extraDealerList.appendChild(item);
    });
  }

  function renderHistory() {
    const dates = getUniqueDates();
    els.historySection.classList.toggle('hidden', dates.length === 0);
    els.historyBody.innerHTML = '';

    dates.forEach((date) => {
      const bankRows = state.bankRows.filter((r) => r.date === date);
      const bankTotal = bankRows.reduce((sum, r) => sum + (r.valueCents || 0), 0);
      const analysis = state.analyses[date];
      const tr = document.createElement('tr');
      tr.dataset.date = date; tr.className = 'history-row-clickable';
      if (analysis) {
        const hasPending = analysis.summary.missingCount || analysis.summary.divergenceCount || analysis.summary.extraDealerCount;
        tr.innerHTML = `<td><strong>${date}</strong></td><td class="right">${formatInteger(bankRows.length)}</td><td class="right">${Core.formatMoney(bankTotal)}</td><td class="right">${formatInteger(analysis.summary.exactCount)}</td><td class="right">${formatInteger(analysis.summary.divergenceCount)}</td><td class="right">${formatInteger(analysis.summary.missingCount)}</td><td>${hasPending ? '<span class="status-chip divergence">COM PENDÊNCIAS</span>' : statusChip('OK')}</td>`;
      } else {
        tr.innerHTML = `<td><strong>${date}</strong></td><td class="right">${formatInteger(bankRows.length)}</td><td class="right">${Core.formatMoney(bankTotal)}</td><td class="right">—</td><td class="right">—</td><td class="right">—</td><td>${statusChip('PENDING')}</td>`;
      }
      els.historyBody.appendChild(tr);
    });

    const analyzed = dates.filter((d) => Boolean(state.analyses[d])).length;
    const percent = dates.length ? Math.round((analyzed / dates.length) * 100) : 0;
    els.progressText.textContent = `${analyzed} de ${dates.length} data${dates.length === 1 ? '' : 's'} analisada${analyzed === 1 ? '' : 's'}`;
    els.progressPercent.textContent = `${percent}%`;
    els.progressBar.style.width = `${percent}%`;
  }

  async function copyMissing() {
    if (!currentAnalysis) return;
    const docs = currentAnalysis.results.filter((r) => r.status === 'DEALER').map((r) => r.document);
    if (!docs.length) return;
    const text = docs.join('\n');
    try { await navigator.clipboard.writeText(text); }
    catch {
      const temp = document.createElement('textarea'); temp.value = text; document.body.appendChild(temp); temp.select(); document.execCommand('copy'); temp.remove();
    }
    toast(`${docs.length} documento(s) copiado(s).`);
  }

  function setWorksheetWidths(ws, widths) { ws['!cols'] = widths.map((wch) => ({ wch })); }

  function exportCurrentAnalysis() {
    if (!currentAnalysis || !window.XLSX) return;
    const s = currentAnalysis.summary;
    const summary = [
      ['Conciliação DIFAL - Banco Util x Dealer'], ['Data', currentAnalysis.date], ['Arquivo Banco Util', state.bankFileName], ['Aba Banco Util', state.bankSheetName],
      ['Banco Util - documentos', s.bankCount], ['Banco Util - valor', s.bankTotalCents / 100], ['Dealer - documentos', s.dealerCount], ['Dealer - valor', s.dealerTotalCents / 100],
      ['OK', s.exactCount], ['Divergências', s.divergenceCount], ['DEALER', s.missingCount], ['Valor pendente DEALER', s.missingTotalCents / 100],
      ['Dealer sem Banco Util', s.extraDealerCount], ['Linhas Dealer não reconhecidas', currentAnalysis.parserRejectedCount || 0], ['Analisado em', formatDateTime(currentAnalysis.analyzedAt)],
    ];
    const differences = currentAnalysis.results.filter((r) => r.status !== 'OK').map((r) => ({
      Data: r.date, 'Nº Documento': r.document, 'Valor Banco Util': r.bankValueCents / 100,
      'Valor Dealer': r.dealerValueCents === null ? '' : r.dealerValueCents / 100,
      Diferença: r.differenceCents === null ? '' : r.differenceCents / 100,
      Status: r.status === 'DIVERGENCIA' ? 'DIVERGÊNCIA' : r.status,
      'Linha Banco Util': r.bankSourceRow || '', 'Linha Dealer': r.dealerSourceLine || '',
    }));
    const missing = currentAnalysis.results.filter((r) => r.status === 'DEALER').map((r) => ({ 'Nº Documento': r.document, Valor: r.bankValueCents / 100, 'Linha Banco Util': r.bankSourceRow || '' }));
    const extras = (currentAnalysis.extras || []).map((r) => ({ Data: r.date, 'Nº Documento': r.document, 'Valor Dealer': r.dealerValueCents / 100, 'Linha Dealer': r.dealerSourceLine || '' }));

    const wb = XLSX.utils.book_new();
    const wsResumo = XLSX.utils.aoa_to_sheet(summary); setWorksheetWidths(wsResumo, [36, 26]);
    const wsDif = XLSX.utils.json_to_sheet(differences); setWorksheetWidths(wsDif, [13, 18, 18, 18, 16, 16, 16, 14]);
    const wsMissing = XLSX.utils.json_to_sheet(missing); setWorksheetWidths(wsMissing, [20, 16, 18]);
    const wsExtras = XLSX.utils.json_to_sheet(extras); setWorksheetWidths(wsExtras, [13, 20, 18, 14]);
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo'); XLSX.utils.book_append_sheet(wb, wsDif, 'Diferenças'); XLSX.utils.book_append_sheet(wb, wsMissing, 'Pendentes Dealer'); XLSX.utils.book_append_sheet(wb, wsExtras, 'Dealer sem Banco');
    XLSX.writeFile(wb, `DIFAL_Conferencia_${currentAnalysis.date.replaceAll('/', '-')}.xlsx`);
  }

  function currentStatusForBankRow(row) {
    const analysis = state.analyses[row.date];
    if (!analysis) return { status: 'NÃO ANALISADO', dealerValueCents: null, differenceCents: null, dealerSourceLine: null };
    const result = analysis.results.find((r) => r.bankId === row.id);
    if (!result) return { status: 'NÃO ANALISADO', dealerValueCents: null, differenceCents: null, dealerSourceLine: null };
    return { status: result.status === 'DIVERGENCIA' ? 'DIVERGÊNCIA' : result.status, dealerValueCents: result.dealerValueCents, differenceCents: result.differenceCents, dealerSourceLine: result.dealerSourceLine };
  }

  function exportPeriod() {
    if (!state.bankRows.length || !window.XLSX) return;
    const detailed = state.bankRows.map((row) => {
      const s = currentStatusForBankRow(row);
      return { Data: row.date, 'Nº Documento': row.document, 'Valor Banco Util': row.valueCents / 100, 'Valor Dealer': s.dealerValueCents === null ? '' : s.dealerValueCents / 100, Diferença: s.differenceCents === null ? '' : s.differenceCents / 100, Status: s.status, 'Linha Banco Util': row.sourceRow, 'Linha Dealer': s.dealerSourceLine || '' };
    });
    const history = getUniqueDates().map((date) => {
      const bankRows = state.bankRows.filter((r) => r.date === date); const a = state.analyses[date];
      return { Data: date, 'Docs Banco Util': bankRows.length, 'Valor Banco Util': bankRows.reduce((sum, r) => sum + r.valueCents, 0) / 100, OK: a ? a.summary.exactCount : '', Divergências: a ? a.summary.divergenceCount : '', DEALER: a ? a.summary.missingCount : '', 'Dealer sem Banco': a ? a.summary.extraDealerCount : '', Status: a ? (a.summary.missingCount || a.summary.divergenceCount || a.summary.extraDealerCount ? 'COM PENDÊNCIAS' : 'OK') : 'NÃO ANALISADO' };
    });
    const missing = detailed.filter((r) => r.Status === 'DEALER').map((r) => ({ Data: r.Data, 'Nº Documento': r['Nº Documento'], Valor: r['Valor Banco Util'] }));

    const wb = XLSX.utils.book_new();
    const wsHist = XLSX.utils.json_to_sheet(history); setWorksheetWidths(wsHist, [13, 17, 19, 10, 15, 10, 18, 18]);
    const wsBase = XLSX.utils.json_to_sheet(detailed); setWorksheetWidths(wsBase, [13, 18, 18, 18, 16, 18, 16, 14]);
    const wsMissing = XLSX.utils.json_to_sheet(missing); setWorksheetWidths(wsMissing, [13, 20, 16]);
    XLSX.utils.book_append_sheet(wb, wsHist, 'Resumo por Data'); XLSX.utils.book_append_sheet(wb, wsBase, 'Base com Status'); XLSX.utils.book_append_sheet(wb, wsMissing, 'Todos Pendentes Dealer');
    XLSX.writeFile(wb, 'DIFAL_Controle_Periodo.xlsx');
  }

  function downloadBackup() {
    if (!state.bankRows.length) return;
    const blob = new Blob([JSON.stringify({ ...state, backupCreatedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `DIFAL_Backup_${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast('Backup do controle baixado.');
  }

  async function restoreBackup(file) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!isValidState(parsed)) throw new Error('Este arquivo não é um backup válido desta aplicação.');
      const ok = window.confirm('Restaurar o backup substituirá os dados atualmente salvos neste navegador. Continuar?');
      if (!ok) return;
      state = { ...defaultState(), ...parsed };
      bankRuntimeSource = 'backup';
      saveState(); currentAnalysis = null; els.dealerText.value = ''; els.emptyDealerCheck.checked = false; renderAll();
      toast('Backup restaurado.');
    } catch (err) { toast(err.message || 'Não foi possível restaurar o backup.', 'error'); }
    finally { els.restoreInput.value = ''; }
  }

  function deleteCurrentDateAnalysis() {
    const date = els.analysisDate.value; if (!date || !state.analyses[date]) return;
    if (!window.confirm(`Excluir a análise salva de ${date}? A base Banco Util permanecerá carregada.`)) return;
    delete state.analyses[date]; saveState(); currentAnalysis = null; els.dealerText.value = ''; els.emptyDealerCheck.checked = false; renderAll(); els.analysisDate.value = date; updateDealerPreview(); toast(`Análise de ${date} excluída.`);
  }

  function resetAll() {
    if (!window.confirm('Isso apagará a planilha carregada e todas as análises salvas neste navegador. Deseja continuar?')) return;
    localStorage.removeItem(STORAGE_KEY); state = defaultState(); bankRuntimeSource = 'none'; currentAnalysis = null; currentParsedDealer = { rows: [], rejected: [], inputLineCount: 0, headerCount: 0 };
    els.bankFile.value = ''; els.dealerText.value = ''; els.emptyDealerCheck.checked = false; renderAll(); toast('Dados locais apagados.');
  }

  function renderAll() {
    renderBankMeta(); populateDateSelect(); renderHistory();
    if (state.lastDate && getUniqueDates().includes(state.lastDate)) els.analysisDate.value = state.lastDate;
    currentAnalysis = state.analyses[els.analysisDate.value] || null;
    updateDealerPreview(); renderCurrentAnalysis();
  }

  // Eventos
  els.bankFile.addEventListener('change', (e) => { const file = e.target.files && e.target.files[0]; if (file) handleBankFile(file); });
  els.analysisDate.addEventListener('change', () => {
    state.lastDate = els.analysisDate.value; saveState(); els.dealerText.value = ''; els.emptyDealerCheck.checked = false;
    currentParsedDealer = { rows: [], rejected: [], inputLineCount: 0, headerCount: 0 }; currentAnalysis = state.analyses[els.analysisDate.value] || null; updateDealerPreview(); renderCurrentAnalysis();
  });
  els.emptyDealerCheck.addEventListener('change', () => { if (els.emptyDealerCheck.checked) els.dealerText.value = ''; updateDealerPreview(); });
  els.dealerText.addEventListener('input', updateDealerPreview);
  els.analyzeBtn.addEventListener('click', analyzeCurrentDate);
  els.clearDealerBtn.addEventListener('click', () => { els.dealerText.value = ''; els.emptyDealerCheck.checked = false; updateDealerPreview(); els.dealerText.focus(); });
  els.deleteDateBtn.addEventListener('click', deleteCurrentDateAnalysis);
  els.copyMissingBtn.addEventListener('click', copyMissing);
  els.exportBtn.addEventListener('click', exportCurrentAnalysis);
  els.exportPeriodBtn.addEventListener('click', exportPeriod);
  els.backupBtn.addEventListener('click', downloadBackup);
  els.restoreInput.addEventListener('change', (e) => { const file = e.target.files && e.target.files[0]; if (file) restoreBackup(file); });
  els.resetBtn.addEventListener('click', resetAll);

  document.querySelectorAll('.pill').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach((b) => b.classList.remove('active')); button.classList.add('active'); activeFilter = button.dataset.filter; renderDifferences();
  }));

  els.historyBody.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-date]'); if (!row) return;
    const date = row.dataset.date; els.analysisDate.value = date; state.lastDate = date; saveState(); currentAnalysis = state.analyses[date] || null;
    els.dealerText.value = ''; els.emptyDealerCheck.checked = false; updateDealerPreview(); renderCurrentAnalysis(); document.querySelector('#dealer-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  renderAll();
})();
