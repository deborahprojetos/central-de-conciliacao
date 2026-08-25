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
    primaryEstablishment: "1029654848",
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
          valorLiquido: moneyNumber(raw["Valor líquido"])
        });
      } catch (e) {
        warnings.push(`Linha ${i+2}: ${e.message}.`);
      }
    });

    if (!rows.length) throw new Error("Nenhum título válido foi encontrado.");

    computeParcelTotals(rows);

    if (!rows.some(r => r.estabelecimento === CONFIG.primaryEstablishment)) {
      warnings.push(
        "A configuração atual foi validada para o estabelecimento " +
        CONFIG.primaryEstablishment + ". Este arquivo não contém esse estabelecimento."
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
      .filter(r =>
        cents(r.valorLiquido) > feeCents &&
        r.autorizacao &&
        r.nsu &&
        r.parcelaAtual >= 1
      )
      .sort((a,b)=>a.dataCredito-b.dataCredito || a.sourceRow-b.sourceRow);
  }

  function processingPlan(parsed, anticipationFee, selected) {
    const s = summarize(parsed);
    const feeCents = cents(anticipationFee);
    if (feeCents <= 0) throw new Error("Informe a Nota de Débito.");
    if (!selected) throw new Error("Selecione o título que receberá a Nota de Débito.");
    const originalCents = cents(selected.valorLiquido);
    if (originalCents <= feeCents) throw new Error("O título escolhido precisa ter valor maior que a Nota de Débito.");
    return {
      totalBaixa: s.net,
      notaDebito: fromCents(feeCents),
      cielo04: fromCents(cents(s.net) - feeCents),
      tituloOriginal: selected.valorLiquido,
      saldoTituloCielo04: fromCents(originalCents - feeCents)
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

  function makeD(r, seq, liquidOverrideCents = null) {
    let s = D_TEMPLATE;
    const est = r.estabelecimento;
    const pay = ddmmyyyy(r.dataCredito);
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

  function makeE(r, seq, liquidOverrideCents = null) {
    let s = E_TEMPLATE;
    const est = r.estabelecimento;
    const auth = (r.autorizacao || "000000").padStart(6,"0").slice(-6);
    const nsu = (r.nsu || "000000").padStart(6,"0").slice(-6);
    const pay = ddmmyyyy(r.dataCredito);
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
    s = replaceRange(s, 482,492, CONFIG.primaryEstablishment);
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

  function makeHeader(parsed) {
    const sum = summarize(parsed);
    const maxDate = yyyymmdd(sum.maxPaymentDate);
    let s =
      "0" +
      CONFIG.primaryEstablishment +
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

  function buildCielo04(parsed, selected, anticipationFee) {
    const plan = processingPlan(parsed, anticipationFee, selected);
    const selectedRow = selected.sourceRow;
    const residualCents = cents(plan.saldoTituloCielo04);
    const lines = [makeHeader(parsed)];

    parsed.rows.forEach((r,i)=>{
      const override = r.sourceRow === selectedRow ? residualCents : null;
      lines.push(makeD(r, i+1, override));
      lines.push(makeE(r, i+1, override));
    });

    lines.push(makeTrailer(parsed, cents(plan.cielo04)));

    const invalid = lines.filter((l,i)=>{
      if (i===0 || i===lines.length-1) return l.length!==250;
      return l.startsWith("D") ? l.length!==400 : l.length!==760;
    });
    if (invalid.length) throw new Error("Falha de validação de tamanho no CIELO04.");

    return lines.join("\r\n") + "\r\n";
  }

  function buildControlReport(parsed, anticipationFee, selected) {
    const s = summarize(parsed);
    const plan = processingPlan(parsed, anticipationFee, selected);
    const lines = [
      "CONTROLE CIELO → DEALER",
      "",
      "TOTAL A BAIXAR NO DEALER: " + moneyBR(plan.totalBaixa),
      "",
      "ETAPA 1 - BAIXA MANUAL DA NOTA DE DÉBITO",
      "Nota de Débito: " + moneyBR(plan.notaDebito),
      "Título escolhido:",
      "  Data de pagamento: " + dateBR(selected.dataCredito),
      "  Data da venda: " + dateBR(selected.dataVenda),
      "  Estabelecimento: " + selected.estabelecimento,
      "  Autorização: " + selected.autorizacao,
      "  NSU: " + selected.nsu,
      "  Parcela: " + selected.parcelaAtual + "/" + selected.totalParcelas,
      "  Valor original do título: " + moneyBR(plan.tituloOriginal),
      "  Saldo após Nota de Débito: " + moneyBR(plan.saldoTituloCielo04),
      "",
      "IMPORTANTE: faça a baixa manual da Nota de Débito ANTES de importar o CIELO04.",
      "",
      "ETAPA 2 - IMPORTAÇÃO CIELO04",
      "Total do CIELO04: " + moneyBR(plan.cielo04),
      "O título acima entra no CIELO04 somente pelo saldo de " + moneyBR(plan.saldoTituloCielo04) + ".",
      "Os demais títulos permanecem com seus valores líquidos integrais.",
      "",
      "CONFERÊNCIA",
      moneyBR(plan.notaDebito) + " (Nota de Débito manual) + " + moneyBR(plan.cielo04) + " (CIELO04) = " + moneyBR(plan.totalBaixa),
      "",
      "Total bruto da planilha: " + moneyBR(s.gross),
      "Taxa administrativa Cielo: " + moneyBR(s.fee),
      "Total líquido original: " + moneyBR(s.net),
      ""
    ];

    lines.push("CADEIA DO RECEBÍVEL ESCOLHIDO:");
    transactionChain(parsed, selected).forEach(r=>{
      const isSelected = r.sourceRow === selected.sourceRow;
      lines.push(
        "- " + dateBR(r.dataCredito) +
        " | parcela " + r.parcelaAtual + "/" + r.totalParcelas +
        " | original " + moneyBR(r.valorLiquido) +
        (isSelected ? " | CIELO04 " + moneyBR(plan.saldoTituloCielo04) + " | NOTA DE DÉBITO NESTE TÍTULO" : "")
      );
    });

    if (parsed.warnings.length) {
      lines.push("", "AVISOS:");
      parsed.warnings.forEach(w=>lines.push("- " + w));
    }
    return lines.join("\r\n");
  }

  global.CieloCore = {
    REQUIRED, CONFIG, parseRows, summarize, moneyBR, dateBR,
    eligibleNoteCandidates, transactionChain, processingPlan,
    buildCielo04, buildControlReport
  };
})(typeof window !== "undefined" ? window : globalThis);
