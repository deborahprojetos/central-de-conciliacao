/* Extrato do mês · leitura da estrutura dia / empresa / banco / PDF. */
(function () {
  'use strict';

  const App = window.ExtratoApp;
  const Folder = window.ExtratoFolder;
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
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const statementName = /^1\s+extrato(?:\s+(\d+(?:[.-]\d+)*))?\.pdf$/i;
  const dayName = /^(0[1-9]|[12]\d|3[01])[ ._-]+(0[1-9]|1[0-2])$/;

  let directory;
  let granted = false;
  let busy = false;
  let entries = [];
  let cache = new Map();

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
    $('monthlyBrowse').hidden = !granted || !entries.length;

    const selections = names(entries, 'company');
    if (!company.value) {
      const active = App.company();
      const match = selections.find(([value]) => window.CentralShell.slug(value) === active);
      if (match) {
        setOptions(company, selections, 'Sem empresas');
        company.value = match[0];
      }
    }
    setOptions(company, selections, 'Sem empresas');
    const byCompany = entries.filter(entry => entry.company === company.value);
    setOptions(day, names(byCompany, 'day').reverse(), 'Sem dias');
    const byDay = byCompany.filter(entry => entry.day === day.value);
    setOptions(bank, names(byDay.filter(entry => entry.bank), 'bank'), 'Sem bancos');
    const byBank = byDay.filter(entry => entry.bank === bank.value);
    const statements = byBank.filter(entry => entry.handle);
    setOptions(file, statements.map(entry => {
      const number = entry.accountHint || (entry.parsed?.account || '').split('/')[1];
      const label = number ? 'Conta ' + number + ' · ' + entry.handle.name : entry.handle.name;
      return [entry.path, label + (entry.error ? ' · Conferir' : '')];
    }), 'Sem extratos');

    const selected = statements.find(entry => entry.path === file.value);
    open.hidden = !selected?.original;
    if (!selected) {
      status('monthlyFileStatus', byBank[0]?.error || (bank.value ? 'Extrato não encontrado.' : 'Nenhuma pasta de banco encontrada.'), byBank[0]?.error);
    } else if (selected.error) {
      status('monthlyFileStatus', selected.error, true);
    } else {
      const count = selected.parsed.rows.filter(row => !row.saldo).length;
      status('monthlyFileStatus', count + (count === 1 ? ' movimentação' : ' movimentações'));
    }
    renderStatement(selected?.error ? null : selected?.parsed);
  }

  function renderStatement(parsed) {
    $('monthlyTable').hidden = !parsed;
    if (!parsed) {
      $('monthlyHead').replaceChildren();
      $('monthlyRows').replaceChildren();
      return;
    }
    const columns = parsed.columns;
    const header = document.createElement('tr');
    for (const label of ['Data', 'Lançamento', 'Razão social', 'CNPJ/CPF', ...columns.map(col => col.name)]) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      header.append(th);
    }
    $('monthlyHead').replaceChildren(header);
    const rows = document.createDocumentFragment();
    for (const row of parsed.rows) {
      const tr = rows.appendChild(document.createElement('tr'));
      if (row.saldo) tr.className = 'is-saldo';
      const values = columns.map(col => typeof row.values[col.id] === 'number' ? brl.format(row.values[col.id]) : '—');
      for (const value of [row.date, row.hist || row.desc, row.party, row.taxId, ...values]) {
        tr.insertCell().textContent = value || '—';
      }
    }
    $('monthlyRows').replaceChildren(rows);
  }

  async function read(entry) {
    try {
      entry.original = await entry.handle.getFile();
      const signature = entry.original.size + ':' + entry.original.lastModified;
      entry.signature = signature;
      const cached = cache.get(entry.path);
      entry.parsed = cached?.signature === signature && cached.parsed ? cached.parsed : await App.readAny(entry.original);
      if (!entry.parsed.rows.length) throw new Error('Nenhum lançamento ou saldo reconhecido.');
      const number = entry.parsed.account.split('/')[1];
      const base = entry.parsed.accountBase.split('/')[1];
      const hint = entry.accountHint.replace(/\D/g, '');
      if (hint && number && hint !== number && hint !== base) {
        throw new Error('A conta do PDF difere do número no nome do arquivo. Confira o original.');
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
        status('monthlyStatus', 'Lendo extrato ' + (i + 1) + ' de ' + statements.length + '…');
        await read(entry);
      }
      entries = next;
      cache = new Map(statements.map(entry => [entry.path, entry]));
      const failures = next.filter(entry => entry.error).length;
      const readCount = statements.filter(entry => !entry.error).length;
      const summary = readCount + (readCount === 1 ? ' extrato lido' : ' extratos lidos');
      status('monthlyStatus', next.length
        ? summary + (failures ? ' · ' + failures + ' para conferir' : '')
        : 'Nenhuma pasta de empresa por dia encontrada. Selecione a pasta do mês, como 11 NOVEMBRO.');
      render();
    } catch (error) {
      status('monthlyStatus', 'Não foi possível ler a pasta. ' + (error.message || ''), true);
    } finally {
      busy = false;
      connect.disabled = refresh.disabled = false;
    }
  }

  async function selectDirectory(handle) {
    directory = handle;
    granted = true;
    entries = [];
    cache.clear();
    render();
    await scan();
  }

  connect.addEventListener('click', async () => {
    try {
      const handle = await window.showDirectoryPicker({ id: 'cf-extratos-mensal', mode: 'read' });
      const remembered = await Folder.saveHandle(handleKey, handle);
      await selectDirectory(handle);
      if (!remembered) status('monthlyStatus', 'Pasta disponível nesta sessão. Conecte-a novamente ao reabrir a Central.');
    } catch (error) {
      if (error.name !== 'AbortError') status('monthlyStatus', 'Não foi possível conectar a pasta do mês.', true);
    }
  });
  allow.addEventListener('click', async () => {
    try {
      if (await directory.requestPermission({ mode: 'read' }) === 'granted') await selectDirectory(directory);
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
    if (typeof window.showDirectoryPicker !== 'function') {
      connect.hidden = true;
      status('monthlyStatus', 'Conecte a pasta pelo Chrome ou Edge.');
      return;
    }
    const saved = await Folder.getSavedHandle(handleKey);
    if (!saved) return;
    directory = saved;
    try {
      if (await saved.queryPermission({ mode: 'read' }) === 'granted') {
        await selectDirectory(saved);
        return;
      }
    } catch {
      status('monthlyStatus', 'Conecte a pasta novamente se o acesso tiver expirado.');
    }
    render();
  }

  init();
})();
