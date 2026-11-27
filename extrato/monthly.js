/* Extrato do mês · leitura da estrutura dia / empresa / banco / PDF. */
(function () {
  'use strict';

  const App = window.ExtratoApp;
  const Shell = window.CentralShell;
  const $ = id => document.getElementById(id);
  const connect = $('monthlyConnect');
  const allow = $('monthlyAllow');
  const refresh = $('monthlyRefresh');
  const company = $('monthlyCompany');
  const day = $('monthlyDay');
  const bank = $('monthlyBank');
  const file = $('monthlyFile');
  const open = $('monthlyOpen');
  const handleKey = 'extratos-dir-mensal';
  const foldersKey = 'extratos-pastas-mensais';
  const statementName = /^1\s+extrato(?:\s+(\d+(?:[.-]\d+)*))?\.pdf$/i;
  const dayName = /^(0[1-9]|[12]\d|3[01])[ ._-]+(0[1-9]|1[0-2])$/;

  let directory;
  let folderId;
  let database;
  let granted = false;
  let busy = false;
  let entries = [];
  let cache = new Map();

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('central-financeira', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('kv');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function stored(key, value) {
    try {
      database ||= openDatabase();
      const db = await database;
      return await new Promise((resolve, reject) => {
        const write = value !== undefined;
        const transaction = db.transaction('kv', write ? 'readwrite' : 'readonly');
        const store = transaction.objectStore('kv');
        const request = write ? store.put(value, key) : store.get(key);
        transaction.oncomplete = () => resolve(write ? true : request.result);
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } catch {
      return undefined;
    }
  }

  async function rememberFolder(handle) {
    const folders = (await stored(foldersKey)) || [];
    let folder;
    for (const known of folders) {
      if (await handle.isSameEntry(known.handle)) {
        folder = known;
        break;
      }
    }
    if (!folder) {
      folder = { id: crypto.randomUUID(), handle };
      await stored(foldersKey, [...folders, folder]);
    }
    await stored(handleKey, folder);
    return folder;
  }

  function status(id, message, error) {
    const element = $(id);
    element.textContent = message;
    element.classList.toggle('is-error', Boolean(error));
  }

  async function directories(parent) {
    const result = [];
    for await (const entry of parent.values()) {
      if (entry.kind === 'directory' && !entry.name.startsWith('.')) result.push(entry);
    }
    return result;
  }

  function setOptions(select, options, placeholder) {
    const previous = select.value;
    select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
    if (options.some(([value]) => value === previous)) select.value = previous;
    if (!options.length) select.add(new Option(placeholder, ''));
    select.disabled = !options.length;
  }

  function names(records, field) {
    return [...new Set(records.map(record => record[field]))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
      .map(name => [name, name]);
  }

  function render() {
    const name = $('monthlyName');
    name.textContent = directory ? directory.name : '';
    name.hidden = !directory;
    allow.hidden = !directory || granted;
    refresh.hidden = !granted;
    const hasFolderEntries = granted && entries.length > 0;
    $('monthlyBrowse').hidden = !hasFolderEntries;
    for (const field of document.querySelectorAll('[data-monthly-filter]')) field.hidden = !hasFolderEntries;

    const selections = hasFolderEntries
      ? names(entries, 'company')
      : Shell.COMPANIES.map(value => [value.name, value.name]);
    const selectedCompany = company.value || App.company();
    setOptions(company, selections, 'Sem empresas');
    const match = selections.find(([value]) => Shell.slug(value) === Shell.slug(selectedCompany));
    if (match) company.value = match[0];
    const id = Shell.companyByName(company.value)?.id || Shell.slug(company.value);
    App.selectCompany(id);
    const byCompany = entries.filter(entry => entry.company === company.value);
    setOptions(day, names(byCompany, 'day').reverse(), 'Sem dias');
    const byDay = byCompany.filter(entry => entry.day === day.value);
    setOptions(bank, names(byDay.filter(entry => entry.bank), 'bank'), 'Sem bancos');
    const byBank = byDay.filter(entry => entry.bank === bank.value);
    const statements = byBank.filter(entry => entry.handle);
    setOptions(file, statements.map(entry => {
      const number = entry.accountHint || (entry.parsed?.account || '').split('/')[1];
      const label = number ? 'Conta ' + number + ' · ' + entry.handle.name : entry.handle.name;
      return [entry.path, label + (entry.error || entry.warning ? ' · Conferir' : '')];
    }), 'Sem extratos');

    const selected = statements.find(entry => entry.path === file.value);
    open.hidden = !selected?.original;
    if (!selected) {
      status('monthlyFileStatus', byBank[0]?.error || (bank.value ? 'Extrato não encontrado.' : 'Nenhuma pasta de banco encontrada.'), byBank[0]?.error);
    } else if (selected.error) {
      status('monthlyFileStatus', selected.error, true);
    } else {
      const count = selected.parsed.rows.filter(row => !row.saldo).length;
      status('monthlyFileStatus', count + (count === 1 ? ' movimentação' : ' movimentações') + (selected.warning ? ' · ' + selected.warning : ''), selected.warning);
    }
    App.showFolderStatement(selected && !selected.error ? {
      key: 'cf:extrato:conferencia:' + JSON.stringify([folderId, selected.path]),
      name: selected.handle.name,
      parsed: selected.parsed
    } : null);
  }

  async function read(entry) {
    try {
      entry.original = await entry.handle.getFile();
      const signature = entry.original.size + ':' + entry.original.lastModified;
      entry.signature = signature;
      const key = ['extrato-mensal', folderId, entry.path];
      const cached = cache.get(entry.path) || await stored(key);
      const bankId = Shell.slug(entry.bank);
      const parserVersion = /^(?:bb|bancodobrasil)$/.test(bankId) ? 3
        : bankId.startsWith('sicoob') ? 4 : /^(?:banco)?bradesco$/.test(bankId) ? 5
          : /^(?:banco)?santander/.test(bankId) ? 7 : 2;
      entry.reused = cached?.version === parserVersion && cached.signature === signature && Boolean(cached.parsed);
      entry.parsed = entry.reused ? cached.parsed : await App.readAny(entry.original, bankId);
      if (!entry.parsed.rows.length) throw new Error('Nenhum lançamento ou saldo reconhecido.');
      entry.version = parserVersion;
      if (!entry.reused) {
        entry.unsaved = !await stored(key, { version: parserVersion, signature, parsed: entry.parsed });
      }
      const number = entry.parsed.account.split('/')[1];
      const base = entry.parsed.accountBase.split('/')[1];
      const normalize = value => (value || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      const hint = normalize(entry.accountHint);
      if (hint && number && hint !== normalize(number) && hint !== normalize(base)) {
        entry.warning = 'Conta no cabeçalho: ' + entry.parsed.account + '. Confira com o nome do arquivo.';
      }
    } catch (error) {
      entry.error = error.message || 'Não foi possível ler o PDF.';
    }
  }

  async function scan() {
    if (!granted || busy) return;
    busy = true;
    connect.disabled = refresh.disabled = true;
    status('monthlyStatus', 'Localizando os extratos…');
    try {
      const month = /^(0[1-9]|1[0-2])\b/.exec(directory.name)?.[1];
      const next = [];
      const days = await directories(directory);
      for (const dayDir of days) {
        const date = dayName.exec(dayDir.name);
        if (!date || (month && date[2] !== month)) continue;
        const dateLabel = date[1] + '/' + date[2];
        for (const companyDir of await directories(dayDir)) {
          const banks = await directories(companyDir);
          const location = { day: dateLabel, company: companyDir.name };
          if (!banks.length) next.push(location);
          for (const bankDir of banks) {
            const group = { ...location, bank: bankDir.name };
            const statements = [];
            try {
              for await (const handle of bankDir.values()) {
                const match = handle.kind === 'file' && statementName.exec(handle.name);
                if (match) statements.push({
                  ...group, handle, accountHint: match[1] || '',
                  path: [dayDir.name, companyDir.name, bankDir.name, handle.name].join('/')
                });
              }
              next.push(...(statements.length ? statements : [group]));
            } catch {
              next.push({ ...group, error: 'Não foi possível listar os arquivos desta pasta de banco.' });
            }
          }
        }
      }
      const statements = next.filter(entry => entry.handle);
      for (const [i, entry] of statements.entries()) {
        status('monthlyStatus', 'Verificando extrato ' + (i + 1) + ' de ' + statements.length + '…');
        await read(entry);
      }
      entries = next;
      cache = new Map(statements.filter(entry => entry.version).map(entry => [entry.path, entry]));
      const failures = next.filter(entry => entry.error || entry.warning).length;
      const available = statements.filter(entry => !entry.error);
      const reused = available.filter(entry => entry.reused).length;
      const unsaved = statements.some(entry => entry.unsaved);
      const summary = available.length + (available.length === 1 ? ' extrato disponível' : ' extratos disponíveis');
      status('monthlyStatus', next.length
        ? summary + (reused ? ' · ' + reused + ' reaproveitados' : '') + (failures ? ' · ' + failures + ' para conferir' : '') +
          (unsaved ? ' · O navegador não guardou parte da leitura.' : '')
        : 'Nenhuma pasta de empresa por dia encontrada. Selecione a pasta do mês, como 11 NOVEMBRO.');
      render();
    } catch (error) {
      status('monthlyStatus', 'Não foi possível ler a pasta. ' + (error.message || ''), true);
    } finally {
      busy = false;
      connect.disabled = refresh.disabled = false;
    }
  }

  async function selectDirectory(folder) {
    directory = folder.handle;
    folderId = folder.id;
    granted = true;
    entries = [];
    cache.clear();
    render();
    await scan();
  }

  connect.addEventListener('click', async () => {
    try {
      const handle = await window.showDirectoryPicker({ id: 'cf-extratos-mensal', mode: 'read' });
      await selectDirectory(await rememberFolder(handle));
    } catch (error) {
      if (error.name !== 'AbortError') status('monthlyStatus', 'Não foi possível conectar a pasta do mês.', true);
    }
  });
  allow.addEventListener('click', async () => {
    try {
      if (await directory.requestPermission({ mode: 'read' }) === 'granted') {
        granted = true;
        render();
        await scan();
      }
    } catch {
      status('monthlyStatus', 'Não foi possível acessar a pasta do mês.', true);
    }
  });
  refresh.addEventListener('click', scan);
  [company, day, bank, file].forEach((select, i, selects) => {
    select.addEventListener('change', () => {
      selects.slice(i + 1).forEach(next => { next.value = ''; });
      render();
    });
  });
  open.addEventListener('click', () => {
    const original = entries.find(entry => entry.path === file.value)?.original;
    if (!original) return;
    const url = URL.createObjectURL(original);
    const link = document.createElement('a');
    link.href = url;
    link.download = original.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });

  async function init() {
    render();
    if (typeof window.showDirectoryPicker !== 'function') {
      connect.hidden = true;
      status('monthlyStatus', 'Conecte a pasta pelo Chrome ou Edge.');
      return;
    }
    const saved = await stored(handleKey);
    if (!saved) return;
    try {
      const folder = saved.handle ? saved : await rememberFolder(saved);
      directory = folder.handle;
      folderId = folder.id;
      if (await directory.queryPermission({ mode: 'read' }) === 'granted') {
        await selectDirectory(folder);
        return;
      }
    } catch {
      status('monthlyStatus', 'Conecte a pasta novamente se o acesso tiver expirado.');
    }
    render();
  }

  init();
})();
