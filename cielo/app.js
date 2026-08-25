(function () {
  "use strict";
  const $ = id => document.getElementById(id);

  let parsed = null;
  let summary = null;
  let candidates = [];
  let selected = null;
  let sourceName = "CIELO";

  const fileInput = $("fileInput");
  const feeInput = $("feeInput");
  const analyzeBtn = $("analyzeBtn");
  const candidateSelect = $("candidateSelect");
  const confirmBox = $("confirmBox");
  const downloadTxt = $("downloadTxt");
  const downloadControl = $("downloadControl");

  function show(id) { $(id).classList.remove("hidden"); }
  function hide(id) { $(id).classList.add("hidden"); }

  function parseFee() {
    let s = feeInput.value.trim().replace(/\s/g,"").replace(/^R\$/i,"");
    if (!s) return 0;
    if (s.includes(",") && s.includes(".")) s = s.replace(/\./g,"").replace(",",".");
    else if (s.includes(",")) s = s.replace(",",".");
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  async function readWorkbook(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, {type:"array", cellDates:true});
    if (!wb.SheetNames.length) throw new Error("O Excel não possui abas.");
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, {defval:"", raw:true, dateNF:"dd/mm/yyyy"});
  }

  async function analyze() {
    $("errorBox").textContent = "";
    hide("errorBox");
    hide("results");
    confirmBox.checked = false;
    toggleDownloads();

    const file = fileInput.files[0];
    if (!file) {
      showError("Selecione o arquivo original da Cielo.");
      return;
    }

    const fee = parseFee();
    if (fee <= 0) {
      showError("Informe o valor total da taxa de antecipação / Nota de Débito.");
      return;
    }

    try {
      const records = await readWorkbook(file);
      parsed = CieloCore.parseRows(records);
      summary = CieloCore.summarize(parsed);
      candidates = CieloCore.eligibleNoteCandidates(parsed, fee);
      sourceName = file.name.replace(/\.[^.]+$/,"") || "CIELO";

      renderSummary(fee);

      if (!candidates.length) {
        throw new Error(
          "Nenhum título com autorização, NSU e parcela possui valor líquido suficiente para " +
          CieloCore.moneyBR(fee) + "."
        );
      }

      candidateSelect.innerHTML = "";
      candidates.forEach((r,idx)=>{
        const opt = document.createElement("option");
        opt.value = String(r.sourceRow);
        opt.textContent =
          (idx===0 ? "Sugestão automática — " : "") +
          CieloCore.dateBR(r.dataCredito) +
          " | Aut. " + r.autorizacao +
          " | NSU " + r.nsu +
          " | Parcela " + r.parcelaAtual + "/" + r.totalParcelas +
          " | " + CieloCore.moneyBR(r.valorLiquido);
        candidateSelect.appendChild(opt);
      });

      selected = candidates[0];
      candidateSelect.value = String(selected.sourceRow);
      renderSelected(fee);

      if (parsed.warnings.length) {
        $("warningBox").textContent =
          parsed.warnings.slice(0,8).map(x=>"• "+x).join("\n") +
          (parsed.warnings.length>8 ? "\n• ... e mais avisos." : "");
        show("warningBox");
      } else {
        hide("warningBox");
      }

      show("results");
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  function renderSummary(fee) {
    const plan = CieloCore.processingPlan(parsed, fee, candidates[0]);
    $("titles").textContent = summary.titles.toLocaleString("pt-BR");
    $("gross").textContent = CieloCore.moneyBR(summary.gross);
    $("adminFee").textContent = CieloCore.moneyBR(summary.fee);
    $("totalClear").textContent = CieloCore.moneyBR(plan.totalBaixa);
    $("noteFee").textContent = CieloCore.moneyBR(plan.notaDebito);
    $("cielo04Total").textContent = CieloCore.moneyBR(plan.cielo04);
    $("establishments").textContent = summary.establishments.join(", ");
  }

  function renderSelected(fee) {
    if (!selected) return;
    $("selAuth").textContent = selected.autorizacao;
    $("selNsu").textContent = selected.nsu;
    $("selParcel").textContent = selected.parcelaAtual + "/" + selected.totalParcelas;
    $("selDate").textContent = CieloCore.dateBR(selected.dataCredito);
    const plan = CieloCore.processingPlan(parsed, fee, selected);
    $("selValue").textContent = CieloCore.moneyBR(selected.valorLiquido);
    $("noteValue").textContent = CieloCore.moneyBR(fee);
    $("residualValue").textContent = CieloCore.moneyBR(plan.saldoTituloCielo04);

    const chain = CieloCore.transactionChain(parsed, selected);
    const host = $("chain");
    host.innerHTML = "";
    chain.forEach((r,idx)=>{
      if (idx) {
        const ar = document.createElement("span");
        ar.className = "arrow";
        ar.textContent = "→";
        host.appendChild(ar);
      }
      const box = document.createElement("div");
      box.className = "chain-item" + (r.sourceRow===selected.sourceRow ? " selected" : "");
      box.innerHTML =
        `<small>${CieloCore.dateBR(r.dataCredito)}</small>` +
        `<strong>Parcela ${r.parcelaAtual}/${r.totalParcelas}</strong>` +
        `<span>Original: ${CieloCore.moneyBR(r.valorLiquido)}</span>` +
        (r.sourceRow===selected.sourceRow ? `<em>Após Nota de Débito: ${CieloCore.moneyBR(plan.saldoTituloCielo04)}</em>` : "");
      host.appendChild(box);
    });

    $("mapping").textContent =
      "CIELO04: posições 18–19 = " +
      String(selected.parcelaAtual).padStart(2,"0") +
      " | posições 20–21 = " +
      String(selected.totalParcelas).padStart(2,"0");

    confirmBox.checked = false;
    toggleDownloads();
  }

  function showError(msg) {
    $("errorBox").textContent = msg;
    show("errorBox");
  }

  function toggleDownloads() {
    const ok = Boolean(parsed && selected && confirmBox.checked);
    downloadTxt.disabled = !ok;
    downloadControl.disabled = !ok;
  }

  function downloadText(name, content, type) {
    const blob = new Blob([content], {type:type || "text/plain;charset=windows-1252"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  analyzeBtn.addEventListener("click", analyze);

  candidateSelect.addEventListener("change", ()=>{
    selected = candidates.find(r=>String(r.sourceRow)===candidateSelect.value) || null;
    renderSelected(parseFee());
  });

  confirmBox.addEventListener("change", toggleDownloads);

  downloadTxt.addEventListener("click", ()=>{
    if (!parsed || !selected || !confirmBox.checked) return;
    const txt = CieloCore.buildCielo04(parsed, selected, parseFee());
    downloadText(
      "CIELO04D_" + CieloCore.CONFIG.primaryEstablishment + "_IMPORTACAO.TXT",
      txt,
      "text/plain;charset=windows-1252"
    );
  });

  downloadControl.addEventListener("click", ()=>{
    if (!parsed || !selected || !confirmBox.checked) return;
    const report = CieloCore.buildControlReport(parsed, parseFee(), selected);
    downloadText(
      "CONTROLE_NOTA_DEBITO_" + sourceName + ".txt",
      report,
      "text/plain;charset=utf-8"
    );
  });

  fileInput.addEventListener("change", ()=>{
    $("fileName").textContent = fileInput.files[0] ? fileInput.files[0].name : "Nenhum arquivo selecionado";
  });
})();
