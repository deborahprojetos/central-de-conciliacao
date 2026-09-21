(function (global) {
  "use strict";

  const REQUIRED = [
    "Data de pagamento",
    "Data do lançamento",
    "Estabelecimento",
    "Código da autorização",
    "NSU/DOC",
    "Número da parcela",
    "Valor bruto",
    "Taxa/tarifa",
    "Valor líquido"
  ];

  // Configuração validada para a base France usada neste projeto.
  const CONFIG = {
    primaryEstablishment: null,
    cnpjBlock: "224243040001192242430400011922424304000119001002",
    headerBatch: "9999999",
    trailerFixedFieldCents: -279464
  };

  // Templates reproduzem a estrutura do arquivo que já havíamos montado para o Dealer.
  // Os campos variáveis são substituídos em posições fixas.
  const D_TEMPLATE =
    "D1029654848224243040001192242430400011922424304000119001002102965484803" +
    "+0000000019563-0000000000407+0000000019156" +
    "03410147000000000000000067410500000103" +
    "102965484820072026000001" +
    "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
    "2007202620072026200720261029654848NNN" +
    "                                                                                                ";

  const E_TEMPLATE =
    "E1029654848001002060602541803102965484820072026000001" +
    "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
    "20260117000000000100" +
    "00001NNN3NNN4392678162" +
    "000004" +
    "0000000000                                        000860000000086" +
    "+0000000019563+0000000019563+0000000019156-0000000000407" +
    "+0000000000000+0000000000000+0000000000000+0000000000000+0000000000000+0000000000000+0000000000000+0000000000000+0000000000000" +
    "-0000000000407" +
    "+0000000000000+0000000000000113001010000" +
    "1029654848" +
    "001619613556315680619613556315680               001006690480000" +
    "30" +
    "00000001" +
    "17012026170120261701202617012026" +
    "0000001" +
    "                         " +
    "20072026" +
    "1029654848" +
    "00NNN03410147000000000000000067410524331786196495003729282N05                                                    ";

  function text(v) {
    if (v === null || v === undefined) return "";
    let s = String(v).trim();
    if (/^-?\d+\.0$/.test(s)) s = s.slice(0, -2);
    return s;
  }

  function moneyNumber(value) {
    if (value === null || value === undefined || value === "") return 0;
    if (typeof value === "number") return Math.round((value + Number.EPSILON) * 100) / 100;
    let s = String(value).trim().replace(/\s/g, "").replace(/^R\$/i, "");
    if (!s) return 0;
    if (s.includes(",") && s.includes(".")) {
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (s.includes(",")) {
      s = s.replace(",", ".");
    }
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error("Valor monetário inválido: " + value);
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function cents(n) {
    return Math.round((Number(n || 0) + Number.EPSILON) * 100);
  }

  function fromCents(c) { return c / 100; }

  function moneyBR(n) {
    return Number(n).toLocaleString("pt-BR", {style:"currency", currency:"BRL"});
  }

  function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
    }
    const s = text(value);
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(Date.UTC(+m[3], +m[2]-1, +m[1]));
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
    throw new Error("Data inválida: " + value);
  }

  function ddmmyyyy(d) {
    return String(d.getUTCDate()).padStart(2,"0") +
      String(d.getUTCMonth()+1).padStart(2,"0") +
      d.getUTCFullYear();
  }

  function yyyymmdd(d) {
    return d.getUTCFullYear() +
      String(d.getUTCMonth()+1).padStart(2,"0") +
      String(d.getUTCDate()).padStart(2,"0");
  }

  function dateBR(d) {
    return new Intl.DateTimeFormat("pt-BR", {timeZone:"UTC"}).format(d);
  }

  function dateKey(d) { return yyyymmdd(d); }

  function signed14(c) {
    return (c >= 0 ? "+" : "-") + String(Math.abs(c)).padStart(13,"0");
  }

  function fee14(c) {
    if (c === 0) return "-0000000000000";
    return signed14(c);
  }

  function signed18(c) {
    return (c >= 0 ? "+" : "-") + String(Math.abs(c)).padStart(17,"0");
  }

  function replaceRange(str, start, end, value) {
    if (value.length !== end-start) {
      throw new Error(`Campo inválido ${start}-${end}: tamanho ${value.length}, esperado ${end-start}`);
    }
    return str.slice(0,start) + value + str.slice(end);
  }

  function identity(r) {
    return [
      r.estabelecimento,
      r.autorizacao,
      r.nsu,
      dateKey(r.dataVenda)
    ].join("|");
  }

  function parseRows(records) {
    if (!Array.isArray(records) || !records.length) throw new Error("A planilha está vazia.");
    const headers = Object.keys(records[0]);
    const missing = REQUIRED.filter(c => !headers.includes(c));
    if (missing.length) {
      throw new Error("Colunas obrigatórias não encontradas:\n- " + missing.join("\n- "));
    }

    const rows = [];
    const warnings = [];

    records.forEach((raw, i) => {
      if (Object.values(raw).every(v => v === "" || v === null || v === undefined)) return;
      try {
        rows.push({
          sourceRow: i + 2,
          dataCredito: parseDate(raw["Data de pagamento"]),
          dataVenda: parseDate(raw["Data do lançamento"]),
          estabelecimento: text(raw["Estabelecimento"]).padStart(10,"0").slice(-10),
          autorizacao: text(raw["Código da autorização"]),
          nsu: text(raw["NSU/DOC"]),
          parcelaRaw: text(raw["Número da parcela"]),
          valorBruto: moneyNumber(raw["Valor bruto"]),
          taxaAdm: moneyNumber(raw["Taxa/tarifa"]),
          valorLiquido: moneyNumber(raw["Valor líquido"]),
          tipoLancamento: text(raw["Tipo de lançamento"] || raw["Tipo do lançamento"] || "")
        });
      } catch (e) {
        warnings.push(`Linha ${i+2}: ${e.message}.`);
      }
    });

    if (!rows.length) throw new Error("Nenhum título válido foi encontrado.");

    computeParcelTotals(rows);

    if (false) {
      warnings.push(
        "A configuração atual foi validada para o estabelecimento " +
        "Estabelecimento é obtido dos próprios registros do arquivo."
      );
    }

    return {rows, warnings};
  }

  function parcelNumber(raw) {
    if (!raw) return 1;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
  }

  function computeParcelTotals(rows) {
    const groups = new Map();

    rows.forEach(r => {
      r.parcelaAtual = parcelNumber(r.parcelaRaw);
      const key = identity(r);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });

    for (const arr of groups.values()) {
      const total = Math.max(1, ...arr.map(r => r.parcelaAtual));
      arr.forEach(r => r.totalParcelas = Math.max(r.parcelaAtual, total));
    }
  }

  function summarize(parsed) {
    const rows = parsed.rows;
    const sum = field => fromCents(rows.reduce((a,r)=>a+cents(r[field]),0));
    return {
      titles: rows.length,
      gross: sum("valorBruto"),
      fee: sum("taxaAdm"),
      net: sum("valorLiquido"),
      establishments: [...new Set(rows.map(r=>r.estabelecimento))].sort(),
      maxPaymentDate: rows.reduce((a,r)=>r.dataCredito>a?r.dataCredito:a, rows[0].dataCredito)
    };
  }

  function eligibleNoteCandidates(parsed, anticipationFee) {
    const feeCents = cents(anticipationFee);
    if (feeCents <= 0) return [];
    return parsed.rows
      .filter(r => {
        const tipo = String(r.tipoLancamento || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();

        // Regras permanentes de elegibilidade para a Nota de Débito:
        // 1) "Valor cedido em negociação" não é um recebível disponível
        //    para compor a baixa manual da Nota de Débito.
        // 2) A autorização 006896 foi baixada indevidamente e fica
        //    permanentemente bloqueada para novas alocações.
        const cedido = tipo.includes("valor cedido em negociacao");
        const bloqueado = String(r.autorizacao || "").trim() === "006896";

        return (
          cents(r.valorLiquido) > 0 &&
          r.autorizacao &&
          r.nsu &&
          r.parcelaAtual >= 1 &&
          !cedido &&
          !bloqueado
        );
      })
      .sort((a,b)=>
        cents(b.valorLiquido)-cents(a.valorLiquido) ||
        a.dataCredito-b.dataCredito ||
        a.sourceRow-b.sourceRow
      );
  }

  // A seleção da Nota de Débito nunca utiliza:
  // - lançamentos "Valor cedido em negociação";
  // - autorização 006896, já baixada indevidamente.
  // Esses registros continuam no processamento/arquivo, mas não são
  // candidatos para a baixa manual da Nota de Débito.
  //
  // A Nota de Débito pode ser maior que qualquer recebível individual.
  // Nesse caso ela é distribuída em vários títulos, começando pelos maiores.
  function buildNoteAllocation(parsed, anticipationFee, selectedRows = null) {
    const feeCents = cents(anticipationFee);
    if (feeCents <= 0) throw new Error("Informe a Nota de Débito.");

    const all = eligibleNoteCandidates(parsed, anticipationFee);
    const selectedSet = selectedRows && selectedRows.length
      ? new Set(selectedRows.map(r => String(r.sourceRow)))
      : null;

    const candidates = selectedSet
      ? all.filter(r => selectedSet.has(String(r.sourceRow)))
      : all;

    let remaining = feeCents;
    const allocations = [];

    for (const r of candidates) {
      if (remaining <= 0) break;
      const original = cents(r.valorLiquido);
      const applied = Math.min(original, remaining);
      if (applied <= 0) continue;

      allocations.push({
        sourceRow: r.sourceRow,
        row: r,
        originalCents: original,
        noteCents: applied,
        residualCents: original - applied
      });
      remaining -= applied;
    }

    if (remaining > 0) {
      throw new Error(
        "Os títulos selecionados não são suficientes para alocar " +
        moneyBR(feeCents / 100) +
        ". Faltam " + moneyBR(remaining / 100) + "."
      );
    }

    return {
      noteCents: feeCents,
      allocations,
      remainingCents: 0,
      selectedTotalCents: allocations.reduce((s,a)=>s+a.originalCents,0)
    };
  }

  function suggestedNoteAllocation(parsed, anticipationFee) {
    return buildNoteAllocation(parsed, anticipationFee, null);
  }

  function processingPlan(parsed, anticipationFee, selectedRows = null) {
    const s = summarize(parsed);
    const allocation = selectedRows && selectedRows.length
      ? buildNoteAllocation(parsed, anticipationFee, selectedRows)
      : suggestedNoteAllocation(parsed, anticipationFee);

    return {
      totalBaixa: s.net,
      notaDebito: fromCents(allocation.noteCents),
      cielo04: fromCents(cents(s.net) - allocation.noteCents),
      allocations: allocation.allocations,
      selectedCount: allocation.allocations.length,
      selectedTotal: fromCents(allocation.selectedTotalCents)
    };
  }

  function transactionChain(parsed, selected) {
    if (!selected) return [];
    const key = identity(selected);
    return parsed.rows
      .filter(r => identity(r) === key)
      .sort((a,b)=>a.parcelaAtual-b.parcelaAtual || a.dataCredito-b.dataCredito);
  }

  function typeCode(r) {
    return (cents(r.valorBruto) <= 0 || r.parcelaAtual <= 1) ? "02" : "03";
  }

  function makeD(r, seq, liquidOverrideCents = null, settlementDate = null) {
    let s = D_TEMPLATE;
    const est = r.estabelecimento;
    const pay = ddmmyyyy(settlementDate ? parseDate(settlementDate) : r.dataCredito);
    const type = typeCode(r);
    const liquidCents = liquidOverrideCents === null ? cents(r.valorLiquido) : liquidOverrideCents;

    s = replaceRange(s, 1,11, est);
    s = replaceRange(s, 59,69, est);
    s = replaceRange(s, 71,85, signed14(cents(r.valorBruto)));
    s = replaceRange(s, 85,99, fee14(cents(r.taxaAdm)));
    s = replaceRange(s, 99,113, signed14(liquidCents));
    s = replaceRange(s, 149,151, type);
    s = replaceRange(s, 151,161, est);
    s = replaceRange(s, 161,169, pay);
    s = replaceRange(s, 169,175, String(seq).padStart(6,"0"));
    s = replaceRange(s, 267,275, pay);
    s = replaceRange(s, 275,283, pay);
    s = replaceRange(s, 283,291, pay);
    s = replaceRange(s, 291,301, est);

    if (s.length !== 400) throw new Error("Registro D com tamanho inválido: " + s.length);
    return s;
  }

  function makeE(r, seq, liquidOverrideCents = null, settlementDate = null) {
    let s = E_TEMPLATE;
    const est = r.estabelecimento;
    const auth = (r.autorizacao || "000000").padStart(6,"0").slice(-6);
    const nsu = (r.nsu || "000000").padStart(6,"0").slice(-6);
    const pay = ddmmyyyy(settlementDate ? parseDate(settlementDate) : r.dataCredito);
    const sale8 = yyyymmdd(r.dataVenda);
    const saleBR = ddmmyyyy(r.dataVenda);
    const type = typeCode(r);
    const liquidCents = liquidOverrideCents === null ? cents(r.valorLiquido) : liquidOverrideCents;

    // REGRA CONFIRMADA NO CIELO04 REAL:
    // 18-19 (1-based) = parcela atual  -> índices JS 17:19
    // 20-21 (1-based) = total parcelas -> índices JS 19:21
    s = replaceRange(s, 1,11, est);
    s = replaceRange(s, 17,19, String(r.parcelaAtual).padStart(2,"0"));
    s = replaceRange(s, 19,21, String(r.totalParcelas).padStart(2,"0"));
    s = replaceRange(s, 21,27, auth);
    s = replaceRange(s, 27,29, type);
    s = replaceRange(s, 29,39, est);
    s = replaceRange(s, 39,47, pay);
    s = replaceRange(s, 47,53, String(seq).padStart(6,"0"));
    s = replaceRange(s, 133,141, sale8);
    s = replaceRange(s, 147,153, String(seq*100).padStart(6,"0"));
    s = replaceRange(s, 175,181, nsu);
    s = replaceRange(s, 246,260, signed14(cents(r.valorBruto)));
    s = replaceRange(s, 260,274, signed14(cents(r.valorBruto)));
    s = replaceRange(s, 274,288, signed14(liquidCents));
    s = replaceRange(s, 288,302, fee14(cents(r.taxaAdm)));
    s = replaceRange(s, 428,442, fee14(cents(r.taxaAdm)));
    s = replaceRange(s, 482,492, est);
    s = replaceRange(s, 555,557, type.slice(-1) + "0");
    s = replaceRange(s, 565,573, saleBR);
    s = replaceRange(s, 573,581, saleBR);
    s = replaceRange(s, 581,589, saleBR);
    s = replaceRange(s, 589,597, saleBR);
    s = replaceRange(s, 597,604, String(seq).padStart(7,"0"));
    s = replaceRange(s, 629,637, pay);
    s = replaceRange(s, 637,647, est);

    if (s.length !== 760) throw new Error("Registro E com tamanho inválido: " + s.length);
    return s;
  }

  function makeHeader(parsed, settlementDate = null) {
    const sum = summarize(parsed);
    const operationDate = settlementDate ? parseDate(settlementDate) : sum.maxPaymentDate;
    const maxDate = yyyymmdd(operationDate);
    const headerEstablishment = parsed.rows.length
      ? String(parsed.rows[0].estabelecimento || "").padStart(10, "0").slice(-10)
      : "0000000000";
    let s =
      "0" +
      headerEstablishment +
      maxDate + maxDate + maxDate +
      CONFIG.headerBatch +
      "CIELO04I" +
      "                    " +
      "01503N";
    s = s.padEnd(250, " ");
    if (s.length !== 250) throw new Error("Header inválido.");
    return s;
  }

  function makeTrailer(parsed, cielo04TotalCents = null) {
    const sum = summarize(parsed);
    const bodyCount = parsed.rows.length * 2;
    const totalCents = cielo04TotalCents === null ? cents(sum.net) : cielo04TotalCents;
    let s =
      "9" +
      String(bodyCount).padStart(11,"0") +
      signed18(totalCents) +
      String(parsed.rows.length).padStart(11,"0") +
      signed18(cents(sum.gross)) +
      signed18(CONFIG.trailerFixedFieldCents) +
      signed18(0);
    s = s.padEnd(250, " ");
    if (s.length !== 250) throw new Error("Trailer inválido: " + s.length);
    return s;
  }

  function buildCielo04(parsed, anticipationFee, selectedRows = null, settlementDate = null) {
    if (!settlementDate) throw new Error("Informe a data da baixa / antecipação.");
    const baixaDate = parseDate(settlementDate);
    const plan = processingPlan(parsed, anticipationFee, selectedRows);
    const allocationByRow = new Map(
      plan.allocations.map(a => [String(a.sourceRow), a.residualCents])
    );
    const lines = [makeHeader(parsed, baixaDate)];

    parsed.rows.forEach((r,i)=>{
      const key = String(r.sourceRow);
      const override = allocationByRow.has(key)
        ? allocationByRow.get(key)
        : null;
      lines.push(makeD(r, i+1, override, baixaDate));
      lines.push(makeE(r, i+1, override, baixaDate));
    });

    lines.push(makeTrailer(parsed, cents(plan.cielo04)));

    const invalid = lines.filter((l,i)=>{
      if (i===0 || i===lines.length-1) return l.length!==250;
      return l.startsWith("D") ? l.length!==400 : l.length!==760;
    });
    if (invalid.length) throw new Error("Falha de validação de tamanho no CIELO04.");

    return lines.join("\r\n") + "\r\n";
  }

  function buildControlReport(parsed, anticipationFee, selectedRows = null, settlementDate = null) {
    if (!settlementDate) throw new Error("Informe a data da baixa / antecipação.");
    const baixaDate = parseDate(settlementDate);
    const s = summarize(parsed);
    const plan = processingPlan(parsed, anticipationFee, selectedRows);
    const lines = [
      "CONTROLE CIELO → DEALER",
      "",
      "TOTAL A BAIXAR NO DEALER: " + moneyBR(plan.totalBaixa),
      "DATA DA BAIXA / ANTECIPAÇÃO: " + dateBR(baixaDate),
      "",
      "ETAPA 1 - BAIXA MANUAL DA NOTA DE DÉBITO",
      "Nota de Débito total: " + moneyBR(plan.notaDebito),
      "Quantidade de títulos utilizados: " + plan.selectedCount,
      ""
    ];

    lines.push("ALOCAÇÃO DA NOTA DE DÉBITO:");
    plan.allocations.forEach((a, idx)=>{
      const r = a.row;
      lines.push(
        (idx+1) + ". " +
        dateBR(r.dataCredito) +
        " | Aut. " + r.autorizacao +
        " | NSU " + r.nsu +
        " | Parcela " + r.parcelaAtual + "/" + r.totalParcelas +
        " | Original " + moneyBR(fromCents(a.originalCents)) +
        " | ND aplicada " + moneyBR(fromCents(a.noteCents)) +
        " | Saldo CIELO04 " + moneyBR(fromCents(a.residualCents))
      );
    });

    lines.push(
      "",
      "IMPORTANTE: faça as baixas manuais da Nota de Débito nos títulos acima ANTES de importar o CIELO04.",
      "",
      "ETAPA 2 - IMPORTAÇÃO CIELO04",
      "Total do CIELO04: " + moneyBR(plan.cielo04),
      "Os títulos utilizados na Nota de Débito entram no CIELO04 somente pelo saldo residual.",
      "Os demais títulos permanecem com seus valores líquidos integrais.",
      "",
      "CONFERÊNCIA",
      moneyBR(plan.notaDebito) + " (Nota de Débito manual) + " +
      moneyBR(plan.cielo04) + " (CIELO04) = " + moneyBR(plan.totalBaixa),
      "",
      "Total bruto da planilha: " + moneyBR(s.gross),
      "Taxa administrativa Cielo: " + moneyBR(s.fee),
      "Total líquido original: " + moneyBR(s.net),
      ""
    );

    if (parsed.warnings.length) {
      lines.push("AVISOS:");
      parsed.warnings.forEach(w=>lines.push("- " + w));
    }
    return lines.join("\r\n");
  }

  global.CieloCore = {
    REQUIRED, CONFIG, parseRows, summarize, moneyBR, dateBR, parseDate,
    eligibleNoteCandidates, suggestedNoteAllocation, buildNoteAllocation,
    transactionChain, processingPlan, buildCielo04, buildControlReport
  };
})(typeof window !== "undefined" ? window : globalThis);
