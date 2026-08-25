(() => {
  'use strict';
  const C = window.ReconcilerCore;
  const state = {
    files: [],
    itauRows: [],
    reconciliation: null,
    view: 'exceptions',
    search: '',
    primaryFile: null
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    itauFile: $('itauFile'), companionFile: $('companionFile'), companionFolder: $('companionFolder'),
    dropZone: $('dropZone'), fileStatus: $('fileStatus'), companionBox: $('companionBox'),
    dealerText: $('dealerText'), dealerStatus: $('dealerStatus'), analyzeBtn: $('analyzeBtn'),
    clearBtn: $('clearBtn'), mainMessage: $('mainMessage'), results: $('results'), resultBody: $('resultBody'),
    emptyState: $('emptyState'), rowCount: $('rowCount'), searchInput: $('searchInput'), copyBtn: $('copyBtn'), exportBtn: $('exportBtn')
  };

  function brl(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  }

  function esc(v) {
    return String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  function setStatus(el, msg, type = 'muted') {
    el.textContent = msg;
    el.className = 'status-line ' + (type === 'ok' ? 'status-ok' : type === 'error' ? 'status-error' : 'muted');
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = Array.from(document.scripts).find(x => x.src === src);
      if (existing && existing.dataset.loaded === '1') return resolve();
      const el = existing || document.createElement('script');
      if (!existing) {
        el.src = src;
        el.async = true;
        document.head.appendChild(el);
      }
      el.addEventListener('load', () => { el.dataset.loaded = '1'; resolve(); }, { once: true });
      el.addEventListener('error', () => reject(new Error('Falha ao carregar biblioteca externa.')), { once: true });
    });
  }

  async function ensurePdfJs() {
    if (window.pdfjsLib) return;
    const sources = [
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
    ];
    for (const src of sources) {
      try { await loadScript(src); if (window.pdfjsLib) return; } catch (_) {}
    }
    throw new Error('Não consegui carregar o leitor de PDF. Verifique a conexão com a internet e recarregue a página.');
  }

  async function ensureTesseract() {
    if (window.Tesseract) return;
    const sources = [
      'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
      'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js'
    ];
    for (const src of sources) {
      try { await loadScript(src); if (window.Tesseract) return; } catch (_) {}
    }
    throw new Error('O PDF é uma imagem e o módulo OCR não carregou. Verifique a conexão com a internet e tente novamente.');
  }

  function mergeFiles(newFiles) {
    const map = new Map(state.files.map(f => [(f.webkitRelativePath || f.name).toLowerCase(), f]));
    for (const f of Array.from(newFiles || [])) map.set((f.webkitRelativePath || f.name).toLowerCase(), f);
    state.files = Array.from(map.values());
  }

  function findPrimaryFile() {
    if (state.primaryFile) return state.primaryFile;
    return state.files.find(f => /\.(pdf|xlsx|xls)$/i.test(f.name)) || state.files.find(f => /\.(htm|html)$/i.test(f.name));
  }

  function normalizePdfText(value) {
    return String(value ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function groupPdfItemsIntoLines(items) {
    const lines = [];
    const tolerance = 2.5;
    const sorted = items
      .filter(i => String(i.str || '').trim())
      .map(i => ({ text: String(i.str || '').trim(), x: i.transform[4], y: i.transform[5], width: i.width || 0 }))
      .sort((a, b) => b.y - a.y || a.x - b.x);

    for (const item of sorted) {
      let line = lines.find(l => Math.abs(l.y - item.y) <= tolerance);
      if (!line) { line = { y: item.y, parts: [] }; lines.push(line); }
      line.parts.push(item);
    }
    for (const line of lines) {
      line.parts.sort((a,b) => a.x - b.x);
      line.text = line.parts.map(p => p.text).join(' ').replace(/\s+/g, ' ').trim();
    }
    return lines.sort((a,b) => b.y - a.y);
  }

  function findPdfHeaderColumns(lines) {
    for (let i = 0; i < lines.length; i++) {
      const windowLines = lines.slice(i, i + 3);
      const parts = windowLines.flatMap(l => l.parts);
      const allText = normalizePdfText(windowLines.map(l => l.text).join(' '));
      if (!allText.includes('pagador') || !allText.includes('valor') || !(allText.includes('seu numero') || allText.includes('seu n'))) continue;

      const findX = (pred) => {
        const hit = parts.find(p => pred(normalizePdfText(p.text)));
        return hit ? hit.x : null;
      };
      const payeeX = findX(t => t.includes('pagador'));
      const dateX = findX(t => t.includes('data') || t.includes('baixa') || t.includes('liquidacao'));
      const valueX = findX(t => t === 'valor' || t.includes('valor(r$)') || t.startsWith('valor'));
      const yourX = findX(t => t.includes('seu numero') || t === 'seu' || t.startsWith('seu n'));
      if (payeeX !== null && valueX !== null && yourX !== null) return { payeeX, dateX, valueX, yourX };
    }
    return null;
  }

  function pdfCellsByColumns(line, cols) {
    const ordered = [
      { key: 'payee', x: cols.payeeX },
      ...(cols.dateX !== null ? [{ key: 'date', x: cols.dateX }] : []),
      { key: 'value', x: cols.valueX },
      { key: 'yourNumber', x: cols.yourX }
    ].sort((a,b) => a.x - b.x);
    const boundaries = ordered.slice(0, -1).map((c, i) => (c.x + ordered[i+1].x) / 2);
    const cells = { payee: '', date: '', value: '', yourNumber: '' };
    for (const part of line.parts) {
      let idx = boundaries.findIndex(b => part.x < b);
      if (idx < 0) idx = ordered.length - 1;
      const key = ordered[idx].key;
      cells[key] = (cells[key] + ' ' + part.text).trim();
    }
    return cells;
  }

  function parsePdfRow(line, cols) {
    const lineText = line.text.replace(/\s+/g, ' ').trim();
    if (!lineText) return null;
    const normalized = normalizePdfText(lineText);
    if (normalized.includes('pagador') || normalized.includes('seu numero') || normalized.includes('saldo total')) return null;

    let payee = '', date = '', value = NaN, yourNumber = '';
    if (cols) {
      const cells = pdfCellsByColumns(line, cols);
      payee = cells.payee.trim();
      date = C.formatDateBR(cells.date);
      value = C.parseMoneyBR(cells.value);
      const ids = cells.yourNumber.match(/\b\d{6,}\b/g) || [];
      yourNumber = ids.length ? ids[ids.length - 1] : '';
    }

    // Fallback for PDF layouts where the bank flattens the table into plain text.
    if (!yourNumber || !Number.isFinite(value)) {
      const dateMatch = lineText.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
      const moneyMatches = [...lineText.matchAll(/(?:R\$\s*)?-?[\d.]+,\d{2}\b/g)];
      const idMatches = [...lineText.matchAll(/\b\d{6,}\b/g)]
        .filter(m => !(dateMatch && m.index >= dateMatch.index && m.index <= dateMatch.index + dateMatch[0].length));
      const idMatch = idMatches.length ? idMatches[idMatches.length - 1] : null;
      const moneyMatch = moneyMatches.length ? moneyMatches[moneyMatches.length - 1] : null;
      if (idMatch) yourNumber = idMatch[0];
      if (moneyMatch) value = C.parseMoneyBR(moneyMatch[0]);
      if (dateMatch) date = C.formatDateBR(dateMatch[0]);
      if ((!payee || normalizePdfText(payee).includes('itau')) && dateMatch) payee = lineText.slice(0, dateMatch.index).trim();
      if ((!payee || payee.length < 2) && moneyMatch) payee = lineText.slice(0, moneyMatch.index).trim();
    }

    payee = payee
      .replace(/^(pagador|sacado)\s*:?\s*/i, '')
      .replace(/\s+/g, ' ').trim();
    if (!payee || !yourNumber || !Number.isFinite(value)) return null;
    if (/^(total|subtotal|pagina|data|valor)$/i.test(payee)) return null;
    return { payee, date, value, yourNumber };
  }

  function cleanOcrDigits(value) {
    return String(value ?? '')
      .replace(/[OoQ]/g, '0')
      .replace(/[Il|]/g, '1')
      .replace(/[^0-9]/g, '');
  }

  function cleanOcrPayee(value) {
    return String(value ?? '')
      .replace(/[|_=~]+/g, ' ')
      .replace(/[—–]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeOcrDate(value) {
    const cleaned = String(value ?? '')
      .replace(/[OoQ]/g, '0')
      .replace(/[Il|]/g, '1')
      .replace(/[^0-9/]/g, '');
    return C.formatDateBR(cleaned);
  }

  function parseOcrItauLine(line) {
    const text = String(line ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return null;

    // Layout do relatório “Boletos baixados e liquidados”:
    // Pagador | Vencimento | Data baixa/liquidação | Valor | Carteira | Nosso número | Seu número.
    // Aceita pequenos artefatos do OCR entre as colunas.
    const date = '[0-9OoQIl|]{1,2}\\/[0-9OoQIl|]{1,2}\\/[0-9OoQIl|]{4}';
    const money = '[0-9OoQIl|.]+,[0-9OoQIl|]{2}';
    const num = '[0-9OoQIl|]{2,12}';
    const rx = new RegExp(`^(.*?)\\s+(${date})\\s+(${date})\\s+[|:;]?\\s*(${money})\\s+[|:;]?\\s*(${num})\\s+[|:;]?\\s*(${num})\\s+[|:;]?\\s*(${num})\\b`, 'i');
    const m = text.match(rx);
    if (!m) return null;

    const payee = cleanOcrPayee(m[1]).replace(/^[-:;|\s]+|[-:;|\s]+$/g, '');
    const baixaDate = normalizeOcrDate(m[3]);
    const value = C.parseMoneyBR(m[4].replace(/[OoQ]/g, '0').replace(/[Il|]/g, '1'));
    const yourNumber = cleanOcrDigits(m[7]);

    if (!payee || !baixaDate || !Number.isFinite(value) || yourNumber.length < 6) return null;
    if (/^(pagador|dados|agencia|cnpj|nome do beneficiario)/i.test(payee)) return null;
    return { payee, date: baixaDate, value, yourNumber };
  }

  function parseOcrItauText(text) {
    const raw = String(text ?? '').replace(/\r/g, '');
    const rows = [];

    // 1) Caminho principal: uma linha OCR = uma linha da tabela.
    for (const line of raw.split('\n')) {
      const parsed = parseOcrItauLine(line);
      if (parsed) rows.push(parsed);
    }

    // 2) Fallback: alguns navegadores/Tesseract quebram uma mesma linha da tabela em 2 linhas.
    // Junta apenas blocos curtos consecutivos para evitar misturar registros diferentes.
    if (!rows.length) {
      const parts = raw.split('\n').map(x => x.trim()).filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        for (let span = 2; span <= 3 && i + span <= parts.length; span++) {
          const parsed = parseOcrItauLine(parts.slice(i, i + span).join(' '));
          if (parsed) { rows.push(parsed); i += span - 1; break; }
        }
      }
    }

    // 3) Último fallback: procura registros no texto corrido. É útil quando o OCR devolve
    // poucas quebras de linha, mas preserva a ordem das colunas.
    if (!rows.length) {
      const compact = raw.replace(/\s+/g, ' ').trim();
      const date = '[0-9OoQIl|]{1,2}\\/[0-9OoQIl|]{1,2}\\/[0-9OoQIl|]{4}';
      const money = '[0-9OoQIl|.]+,[0-9OoQIl|]{2}';
      const num = '[0-9OoQIl|]{2,12}';
      const rx = new RegExp(`([A-Za-zÀ-ÿ0-9 .&'()\\/-]{2,80}?)\\s+(${date})\\s+(${date})\\s+[|:;]?\\s*(${money})\\s+[|:;]?\\s*(${num})\\s+[|:;]?\\s*(${num})\\s+[|:;]?\\s*(${num})\\b`, 'gi');
      let m;
      while ((m = rx.exec(compact))) {
        const candidate = parseOcrItauLine(m[0]);
        if (candidate) rows.push(candidate);
      }
    }

    const unique = [];
    const seen = new Set();
    for (const r of rows) {
      const key = `${r.payee}|${r.date}|${r.value}|${r.yourNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(r);
    }
    return unique;
  }

  function preprocessCanvasForOcr(sourceCanvas) {
    const out = document.createElement('canvas');
    out.width = sourceCanvas.width;
    out.height = sourceCanvas.height;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(sourceCanvas, 0, 0);
    const image = ctx.getImageData(0, 0, out.width, out.height);
    const d = image.data;
    // Preto e branco suave aumenta a estabilidade dos números pequenos sem destruir letras finas.
    for (let i = 0; i < d.length; i += 4) {
      const gray = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      const v = gray > 218 ? 255 : gray < 105 ? 0 : Math.round((gray - 105) * 255 / 113);
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(image, 0, 0);
    return out;
  }

  async function createOcrWorker(logger, fileName) {
    const T = window.Tesseract;
    const oem = (T.OEM && T.OEM.LSTM_ONLY) || 1;
    const attempts = [
      {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        logger
      },
      { logger }
    ];

    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      try {
        setStatus(els.fileStatus, `${fileName}: carregando motor OCR${i ? ' (tentativa alternativa)' : ''}...`);
        const workerPromise = T.createWorker('eng', oem, attempts[i]);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Tempo excedido ao carregar o motor OCR.')), 180000)
        );
        return await Promise.race([workerPromise, timeoutPromise]);
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error('Não consegui iniciar o OCR do PDF. ' + (lastErr && lastErr.message ? lastErr.message : 'Recarregue a página e tente novamente.'));
  }

  async function parseItauPdfWithOcr(pdf, fileName) {
    await ensureTesseract();

    setStatus(els.fileStatus, `${fileName}: PDF em imagem detectado. Iniciando OCR...`);
    let currentPage = 1;
    const logger = m => {
      if (m && m.status === 'recognizing text' && Number.isFinite(m.progress)) {
        const pct = Math.max(0, Math.min(100, Math.round(m.progress * 100)));
        setStatus(els.fileStatus, `${fileName}: OCR página ${currentPage}/${pdf.numPages} — ${pct}%`);
      }
    };

    const worker = await createOcrWorker(logger, fileName);
    setStatus(els.fileStatus, `${fileName}: motor OCR carregado. Preparando leitura...`);

    try {
      if (worker.setParameters) {
        await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      }

      const rows = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        currentPage = p;
        setStatus(els.fileStatus, `${fileName}: preparando OCR página ${p}/${pdf.numPages}...`);
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 3.0 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;

        const prepared = preprocessCanvasForOcr(canvas);
        let result = await worker.recognize(prepared);
        let text = result && result.data ? String(result.data.text || '') : '';
        let pageRows = parseOcrItauText(text);

        // Se a página inteira falhar, tenta somente a faixa onde a tabela costuma ficar.
        // Isso remove cabeçalho/rodapé e aumenta bastante a precisão em PDFs “Microsoft Print to PDF”.
        if (!pageRows.length) {
          setStatus(els.fileStatus, `${fileName}: refinando leitura da tabela na página ${p}...`);
          const crop = document.createElement('canvas');
          const cropCtx = crop.getContext('2d', { willReadFrequently: true });
          const top = Math.floor(prepared.height * 0.14);
          const bottom = Math.floor(prepared.height * 0.47);
          crop.width = prepared.width;
          crop.height = Math.max(1, bottom - top);
          cropCtx.fillStyle = '#ffffff'; cropCtx.fillRect(0, 0, crop.width, crop.height);
          cropCtx.drawImage(prepared, 0, top, prepared.width, crop.height, 0, 0, crop.width, crop.height);
          result = await worker.recognize(crop);
          text = result && result.data ? String(result.data.text || '') : '';
          pageRows = parseOcrItauText(text);
          crop.width = crop.height = 1;
        }

        pageRows.forEach(r => rows.push({ ...r, page: p }));
        canvas.width = canvas.height = 1;
        prepared.width = prepared.height = 1;
      }

      const unique = [];
      const seen = new Set();
      for (const r of rows) {
        const key = `${r.payee}|${r.date}|${r.value}|${r.yourNumber}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(r);
      }

      if (!unique.length) {
        throw new Error('O PDF foi aberto, mas o OCR não reconheceu as linhas da tabela. Use o relatório “Boletos baixados e liquidados” sem recortar a página.');
      }

      return unique.map((r, i) => {
        const parsed = C.parseBankTitle(r.yourNumber);
        return {
          id: 'I' + (i + 1),
          sourceRow: `PDF OCR pág. ${r.page}`,
          payee: r.payee,
          yourNumber: r.yourNumber,
          note: parsed.note,
          installment: parsed.installment,
          date: r.date,
          value: C.round2(r.value)
        };
      }).filter(r => r.note);
    } finally {
      try { await worker.terminate(); } catch (_) {}
    }
  }

  async function parseItauPdf(file) {
    await ensurePdfJs();
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const rawRows = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const lines = groupPdfItemsIntoLines(content.items);
      const cols = findPdfHeaderColumns(lines);
      for (const line of lines) {
        const row = parsePdfRow(line, cols);
        if (row) rawRows.push({ ...row, page: p });
      }
    }

    // Remove exact duplicates that can occur when a PDF contains an invisible text layer twice.
    const unique = [];
    const seen = new Set();
    for (const r of rawRows) {
      const key = `${r.payee}|${r.date}|${r.value}|${r.yourNumber}`;
      if (seen.has(key)) continue;
      seen.add(key); unique.push(r);
    }

    // Alguns PDFs emitidos pelo Itaú via “Microsoft Print to PDF” são somente imagem.
    // Nesses casos, cai automaticamente para OCR no navegador.
    if (!unique.length) return parseItauPdfWithOcr(pdf, file.name);

    return unique.map((r, i) => {
      const parsed = C.parseBankTitle(r.yourNumber);
      return {
        id: 'I' + (i + 1), sourceRow: `PDF pág. ${r.page}`,
        payee: r.payee, yourNumber: r.yourNumber, note: parsed.note, installment: parsed.installment,
        date: r.date, value: C.round2(r.value)
      };
    }).filter(r => r.note);
  }

  async function readTextWindows(file) {
    const buffer = await file.arrayBuffer();
    try { return new TextDecoder('windows-1252').decode(buffer); }
    catch { return new TextDecoder('utf-8').decode(buffer); }
  }

  function htmlTableToMatrix(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const tables = Array.from(doc.querySelectorAll('table'));
    if (!tables.length) return [];
    // Choose the table most likely to contain the bank report.
    const table = tables.sort((a,b) => b.rows.length - a.rows.length)[0];
    return Array.from(table.rows).map(tr => Array.from(tr.cells).map(td => td.innerText.trim()));
  }

  function findCompanionFromHtml(html) {
    const matches = [...html.matchAll(/(?:href|src)=["']([^"']*sheet\d+\.htm)["']/gi)].map(m => m[1]);
    return matches[0] || '';
  }

  function locateCompanion(ref) {
    const base = String(ref || '').split(/[\\/]/).pop().toLowerCase();
    return state.files.find(f => {
      const name = f.name.toLowerCase();
      const rel = (f.webkitRelativePath || '').toLowerCase();
      return name === base || rel.endsWith('/' + base) || rel.endsWith(base);
    });
  }

  async function parseItauFiles() {
    const primary = findPrimaryFile();
    if (!primary) throw new Error('Selecione o arquivo do Itaú.');

    const ext = (primary.name.split('.').pop() || '').toLowerCase();
    let matrix = [];

    if (ext === 'pdf') {
      state.itauRows = await parseItauPdf(primary);
      els.companionBox.classList.add('hidden');
      const total = state.itauRows.reduce((s, r) => s + r.value, 0);
      setStatus(els.fileStatus, `${primary.name}: ${state.itauRows.length} recebimentos identificados no PDF (${brl(total)}).`, 'ok');
      return state.itauRows;
    }

    if (!window.XLSX) throw new Error('A biblioteca de Excel não carregou. Verifique sua conexão e recarregue a página.');

    if (ext === 'htm' || ext === 'html') {
      const html = await readTextWindows(primary);
      matrix = htmlTableToMatrix(html);
      if (!matrix.length) throw new Error('O arquivo HTML selecionado não contém a tabela de recebimentos do Itaú.');
    } else if (ext === 'xls') {
      const header = new Uint8Array(await primary.slice(0, 512).arrayBuffer());
      const probe = new TextDecoder('windows-1252').decode(header).trimStart().toLowerCase();
      if (probe.startsWith('<html') || probe.startsWith('<!doctype')) {
        const html = await readTextWindows(primary);
        matrix = htmlTableToMatrix(html);
        if (!matrix.length) {
          const ref = findCompanionFromHtml(html);
          const companion = locateCompanion(ref || 'sheet001.htm');
          if (!companion) {
            els.companionBox.classList.remove('hidden');
            throw new Error('Este VEICULOS.xls usa uma pasta auxiliar. Selecione também o arquivo sheet001.htm.');
          }
          const sheetHtml = await readTextWindows(companion);
          matrix = htmlTableToMatrix(sheetHtml);
          if (!matrix.length) throw new Error('O arquivo auxiliar foi localizado, mas não encontrei a tabela de recebimentos.');
        }
      } else {
        const wb = XLSX.read(await primary.arrayBuffer(), { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'dd/mm/yyyy' });
      }
    } else {
      const wb = XLSX.read(await primary.arrayBuffer(), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'dd/mm/yyyy' });
    }

    state.itauRows = C.extractItauRows(matrix);
    els.companionBox.classList.add('hidden');
    const total = state.itauRows.reduce((s, r) => s + r.value, 0);
    setStatus(els.fileStatus, `${primary.name}: ${state.itauRows.length} recebimentos identificados (${brl(total)}).`, 'ok');
    return state.itauRows;
  }

  async function handleFiles(files, setPrimary = false) {
    if (setPrimary && files && files.length) {
      state.primaryFile = files[0];
      state.itauRows = [];
      state.reconciliation = null;
    }
    mergeFiles(files);
    const primary = findPrimaryFile();
    if (primary) setStatus(els.fileStatus, `${primary.name} selecionado. Lendo dados...`);
    els.analyzeBtn.disabled = true;
    try {
      await parseItauFiles();
    } catch (err) {
      state.itauRows = [];
      setStatus(els.fileStatus, err.message, 'error');
    } finally {
      els.analyzeBtn.disabled = false;
    }
  }

  function analyze() {
    els.mainMessage.textContent = '';
    try {
      if (!state.itauRows.length) throw new Error('Carregue primeiro o arquivo do Itaú.');
      const dealerText = els.dealerText.value.trim();
      if (!dealerText) throw new Error('Cole os movimentos do Dealer.');
      const entries = C.parseDealerText(dealerText);
      setStatus(els.dealerStatus, `${entries.length} movimentos reconhecidos no Dealer.`, 'ok');
      state.reconciliation = C.reconcile(state.itauRows, entries);
      state.view = 'exceptions';
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === state.view));
      updateSummary();
      render();
      els.results.classList.remove('hidden');
      els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      els.mainMessage.textContent = err.message;
      els.mainMessage.style.color = '#c0392b';
    }
  }

  function updateSummary() {
    const rr = state.reconciliation.results;
    const total = rr.reduce((s,r) => s + r.value, 0);
    const ok = rr.filter(r => r.status === 'ok' || r.status === 'adjustment').length;
    const diffs = rr.filter(r => r.status === 'difference' || r.status === 'missing').length;
    const missing = rr.filter(r => r.status === 'missing').length;
    const adjustments = rr.filter(r => r.status === 'adjustment').length;
    const withInterest = rr.filter(r => r.interest > C.MONEY_TOLERANCE).length;
    const withDiscount = rr.filter(r => r.discount > C.MONEY_TOLERANCE).length;

    $('kpiItau').textContent = rr.length;
    $('kpiItauTotal').textContent = brl(total);
    $('kpiOk').textContent = ok;
    $('kpiOkSub').textContent = `${rr.length ? Math.round(ok / rr.length * 100) : 0}% sem diferença`;
    $('kpiDiff').textContent = diffs;
    $('kpiMissing').textContent = `${missing} não localizado${missing === 1 ? '' : 's'}`;
    $('kpiAdjust').textContent = adjustments;
    $('kpiAdjustSub').textContent = `${withInterest} com juros · ${withDiscount} com desconto`;
  }

  function currentRows() {
    if (!state.reconciliation) return [];
    let rows;
    if (state.view === 'exceptions') rows = state.reconciliation.results.filter(r => r.status === 'difference' || r.status === 'missing');
    else if (state.view === 'adjustments') rows = state.reconciliation.results.filter(r => r.status === 'adjustment' || r.interest > C.MONEY_TOLERANCE || r.discount > C.MONEY_TOLERANCE);
    else if (state.view === 'dealerOnly') rows = state.reconciliation.dealerOnly;
    else rows = state.reconciliation.results;

    const q = C.normalizeText(state.search);
    if (q) rows = rows.filter(r => C.normalizeText(`${r.payee} ${r.note} ${r.yourNumber || ''} ${r.reason}`).includes(q));
    return rows;
  }

  function statusHtml(r) {
    let cls = 'badge-ok';
    if (r.status === 'difference' || r.status === 'missing' || r.status === 'dealerOnly') cls = 'badge-error';
    else if (r.status === 'adjustment') cls = 'badge-warn';

    const details = [];
    if (r.receipt > 0) details.push(`Recebimento ${brl(r.receipt)}`);
    if (r.interest > C.MONEY_TOLERANCE) details.push(`Juros +${brl(r.interest)}`);
    if (r.discount > C.MONEY_TOLERANCE) details.push(`Desconto −${brl(r.discount)}`);
    if ((r.interest > C.MONEY_TOLERANCE || r.discount > C.MONEY_TOLERANCE) && Number.isFinite(r.dealerAdjusted)) details.push(`Total ajustado ${brl(r.dealerAdjusted)}`);
    if ((r.status === 'difference') && Number.isFinite(r.finalDifference)) details.push(`Saldo final ${brl(r.finalDifference)}`);
    if (r.launch) details.push(`Lançamento ${r.launch}`);
    if (r.dateRelation === 'cash_next_day' && r.date && r.dealerDate) details.push(`Data Itaú ${r.date} → Dealer ${r.dealerDate}`);
    else if (r.dateRelation === 'cash_later' && r.date && r.dealerDate) details.push(`Data Itaú ${r.date} → Dealer ${r.dealerDate}`);
    else if (r.dateFallback && r.dealerDate) details.push(`Dealer em ${r.dealerDate}`);
    return `<span class="badge ${cls}">${esc(r.reason)}</span>${details.length ? `<span class="detail">${esc(details.join(' · '))}</span>` : ''}`;
  }

  function render() {
    const rows = currentRows();
    els.resultBody.innerHTML = rows.map(r => {
      const diffCls = r.difference > C.MONEY_TOLERANCE ? 'positive' : (r.difference < -C.MONEY_TOLERANCE ? 'negative' : '');
      const parcel = r.installment ? `Parcela ${esc(r.installment)}` : (r.date ? esc(r.date) : '');
      return `<tr>
        <td class="payee">${esc(r.payee || '—')}</td>
        <td class="title-cell"><strong>${esc(r.note)}</strong><small>${parcel}</small></td>
        <td class="money">${brl(r.value)}</td>
        <td class="money">${brl(r.dealerValue)}</td>
        <td class="money ${diffCls}">${brl(r.difference)}</td>
        <td>${statusHtml(r)}</td>
      </tr>`;
    }).join('');
    els.emptyState.classList.toggle('hidden', rows.length > 0);
    els.rowCount.textContent = `${rows.length} registro${rows.length === 1 ? '' : 's'}`;
  }

  function exportExcel() {
    if (!state.reconciliation || !window.XLSX) return;
    const rows = state.reconciliation.results.map(r => ({
      'Pagador': r.payee,
      'Título Dealer': r.note,
      'Parcela': r.installment,
      'Seu número Itaú': r.yourNumber,
      'Data Itaú': r.date,
      'Valor Itaú': r.value,
      'Recebimento Dealer': r.receipt,
      'Juros': r.interest,
      'Desconto': r.discount,
      'Valor Dealer (recebimento)': r.dealerValue,
      'Valor Dealer ajustado': r.dealerAdjusted,
      'Diferença Itaú x recebimento': r.difference,
      'Saldo final após ajustes': r.finalDifference,
      'Situação': r.reason,
      'Lançamento Dealer': r.launch || '',
      'Data Dealer (Dt. Caixa)': r.dealerDate || '',
      'Data Dealer (Dt. Movimento)': r.dealerMovementDate || '',
      'Relação de datas': r.dateRelation || ''
    }));
    const exceptions = rows.filter((_, i) => ['difference','missing'].includes(state.reconciliation.results[i].status));
    const dealerOnly = state.reconciliation.dealerOnly.map(r => ({
      'Título Dealer': r.note, 'Data Dealer (Dt. Caixa)': r.date, 'Data Dealer (Dt. Movimento)': r.dealerMovementDate || '', 'Recebimento Dealer': r.receipt,
      'Juros': r.interest, 'Desconto': r.discount, 'Valor Dealer (recebimento)': r.dealerValue, 'Valor Dealer ajustado': r.dealerAdjusted,
      'Diferença Itaú x recebimento': r.difference, 'Saldo final após ajustes': r.finalDifference,
      'Situação': r.reason, 'Lançamento Dealer': r.launch || ''
    }));

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(exceptions.length ? exceptions : [{ 'Situação': 'Sem divergências' }]);
    const ws2 = XLSX.utils.json_to_sheet(rows);
    const ws3 = XLSX.utils.json_to_sheet(dealerOnly.length ? dealerOnly : [{ 'Situação': 'Nenhum movimento somente no Dealer' }]);
    ws1['!cols'] = [{wch:34},{wch:15},{wch:9},{wch:17},{wch:12},{wch:15},{wch:18},{wch:12},{wch:12},{wch:16},{wch:15},{wch:34},{wch:19},{wch:14}];
    ws2['!cols'] = ws1['!cols'];
    XLSX.utils.book_append_sheet(wb, ws1, 'Divergências');
    XLSX.utils.book_append_sheet(wb, ws2, 'Conciliação Completa');
    XLSX.utils.book_append_sheet(wb, ws3, 'Somente Dealer');
    XLSX.writeFile(wb, `conciliacao_itau_dealer_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  async function copyTable() {
    const rows = currentRows();
    const header = ['Pagador','Título','Valor Itaú','Valor Dealer','Diferença','Situação'];
    const body = rows.map(r => [r.payee || '', r.note, r.value ?? '', r.dealerValue ?? '', r.difference ?? '', r.reason].join('\t'));
    try {
      await navigator.clipboard.writeText([header.join('\t'), ...body].join('\n'));
      const old = els.copyBtn.textContent;
      els.copyBtn.textContent = 'Copiado';
      setTimeout(() => els.copyBtn.textContent = old, 1200);
    } catch {
      alert('Não foi possível copiar automaticamente.');
    }
  }

  function clearAll() {
    state.files = []; state.itauRows = []; state.reconciliation = null; state.view = 'exceptions'; state.search = ''; state.primaryFile = null;
    els.itauFile.value = ''; els.companionFile.value = ''; els.companionFolder.value = '';
    els.dealerText.value = ''; els.searchInput.value = ''; els.mainMessage.textContent = '';
    els.results.classList.add('hidden'); els.companionBox.classList.add('hidden');
    setStatus(els.fileStatus, 'Nenhum arquivo carregado.');
    setStatus(els.dealerStatus, 'Aguardando dados do Dealer.');
  }

  els.itauFile.addEventListener('change', e => handleFiles(e.target.files, true));
  els.companionFile.addEventListener('change', e => handleFiles(e.target.files));
  els.companionFolder.addEventListener('change', e => handleFiles(e.target.files));
  els.dealerText.addEventListener('input', () => {
    const text = els.dealerText.value.trim();
    if (!text) return setStatus(els.dealerStatus, 'Aguardando dados do Dealer.');
    try { const rows = C.parseDealerText(text); setStatus(els.dealerStatus, `${rows.length} movimentos reconhecidos.`, 'ok'); }
    catch { setStatus(els.dealerStatus, 'Texto inserido. A análise validará a estrutura.', 'muted'); }
  });
  els.analyzeBtn.addEventListener('click', analyze);
  els.clearBtn.addEventListener('click', clearAll);
  els.exportBtn.addEventListener('click', exportExcel);
  els.copyBtn.addEventListener('click', copyTable);
  els.searchInput.addEventListener('input', e => { state.search = e.target.value; render(); });
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    state.view = tab.dataset.view;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    render();
  }));

  ['dragenter','dragover'].forEach(ev => els.dropZone.addEventListener(ev, e => { e.preventDefault(); els.dropZone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(ev => els.dropZone.addEventListener(ev, e => { e.preventDefault(); els.dropZone.classList.remove('dragover'); }));
  els.dropZone.addEventListener('drop', e => handleFiles(e.dataTransfer.files, true));
})();
