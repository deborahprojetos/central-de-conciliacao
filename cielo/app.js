(function () {
  "use strict";
  const $ = id => document.getElementById(id);

  let parsed = null;
  let summary = null;
  let candidates = [];
  let selectedRows = [];
  let sourceName = "CIELO";

  const fileInput = $("fileInput");
  const feeInput = $("feeInput");
  const analyzeBtn = $("analyzeBtn");
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
    const range = XLSX.utils.decode_range(ws["!ref"]);
    let headerRow = null;
    const requiredMarkers = ["Data de pagamento","Valor bruto","Valor líquido","NSU/DOC"];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const values = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({r:r,c:c})];
        values.push(cell ? String(cell.v).trim() : "");
      }
      if (requiredMarkers.every(m => values.includes(m))) {
        headerRow = r;
        break;
      }
    }
    if (headerRow === null) {
      throw new Error("Não foi localizada a linha de cabeçalho da planilha Cielo.");
    }
    return XLSX.utils.sheet_to_json(ws, {
      defval:"",
      raw:true,
      dateNF:"dd/mm/yyyy",
      range: headerRow
    });
  }

  function allocationRows() {
    return selectedRows
      .map(row => candidates.find(r => String(r.sourceRow) === String(row.sourceRow)))
      .filter(Boolean);
  }

  function getPlan() {
    return CieloCore.processingPlan(parsed, parseFee(), allocationRows());
  }

  function renderAllocation() {
    const host = $("allocationBody");
    const search = ($("allocationSearch").value || "").trim().toLowerCase();
    const selectedSet = new Set(selectedRows.map(r => String(r.sourceRow)));

    const visible = candidates
      .filter(r => {
        if (!search) return true;
        return [
          r.autorizacao, r.nsu, r.parcelaAtual + "/" + r.totalParcelas,
          CieloCore.dateBR(r.dataCredito), CieloCore.moneyBR(r.valorLiquido)
        ].join(" ").toLowerCase().includes(search);
      })
      .slice(0, 80);

    host.innerHTML = "";
    visible.forEach(r => {
      const checked = selectedSet.has(String(r.sourceRow));
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td><input type="checkbox" class="allocation-check" data-row="${r.sourceRow}" ${checked ? "checked" : ""}></td>` +
        `<td>${CieloCore.dateBR(r.dataCredito)}</td>` +
        `<td>${r.autorizacao}</td>` +
        `<td>${r.nsu}</td>` +
        `<td>${r.parcelaAtual}/${r.totalParcelas}</td>` +
        `<td class="money">${CieloCore.moneyBR(r.valorLiquido)}</td>`;
      host.appendChild(tr);
    });

    host.querySelectorAll(".allocation-check").forEach(chk => {
      chk.addEventListener("change", () => {
        const row = candidates.find(r => String(r.sourceRow) === String(chk.dataset.row));
        if (!row) return;
        if (chk.checked) {
          if (!selectedSet.has(String(row.sourceRow))) selectedRows.push(row);
        } else {
          selectedRows = selectedRows.filter(r => String(r.sourceRow) !== String(row.sourceRow));
        }
        refreshAllocation();
      });
    });
  }

  function refreshAllocation() {
    try {
      const plan = getPlan();
      $("allocationStatus").className = "allocation-status ok";
      $("allocationStatus").textContent =
        `${plan.selectedCount} título(s) selecionado(s) • ` +
        `ND alocada: ${CieloCore.moneyBR(plan.notaDebito)} • ` +
        `CIELO04: ${CieloCore.moneyBR(plan.cielo04)}`;

      $("selectedCount").textContent = String(plan.selectedCount);
      $("selectedTotal").textContent = CieloCore.moneyBR(plan.selectedTotal);

      const map = new Map(plan.allocations.map(a => [String(a.sourceRow), a]));
      const host = $("allocationDetails");
      host.innerHTML = "";
      plan.allocations.forEach(a => {
        const r = a.row;
        const tr = document.createElement("tr");
        tr.innerHTML =
          `<td>${CieloCore.dateBR(r.dataCredito)}</td>` +
          `<td>${r.autorizacao}</td>` +
          `<td>${r.nsu}</td>` +
          `<td>${r.parcelaAtual}/${r.totalParcelas}</td>` +
          `<td class="money">${CieloCore.moneyBR(a.originalCents/100)}</td>` +
          `<td class="money">${CieloCore.moneyBR(a.noteCents/100)}</td>` +
          `<td class="money residual">${CieloCore.moneyBR(a.residualCents/100)}</td>`;
        host.appendChild(tr);
      });

      renderSummary(parseFee(), plan);
      toggleDownloads();
    } catch (e) {
      $("allocationStatus").className = "allocation-status error";
      $("allocationStatus").textContent = e.message || String(e);
      $("selectedCount").textContent = String(selectedRows.length);
      $("selectedTotal").textContent = "—";
      $("allocationDetails").innerHTML = "";
      toggleDownloads();
    }
  }

  function selectAutomatic() {
    const fee = parseFee();
    if (!parsed || fee <= 0) return;
    const suggested = CieloCore.suggestedNoteAllocation(parsed, fee);
    selectedRows = suggested.allocations.map(a => a.row);
    renderAllocation();
    refreshAllocation();
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

      if (!candidates.length) {
        throw new Error("Nenhum título válido para alocação da Nota de Débito foi encontrado.");
      }

      const suggested = CieloCore.suggestedNoteAllocation(parsed, fee);
      selectedRows = suggested.allocations.map(a => a.row);

      renderSummary(fee, CieloCore.processingPlan(parsed, fee, selectedRows));
      renderAllocation();
      refreshAllocation();

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

  function renderSummary(fee, plan = null) {
    if (!plan && parsed) {
      try { plan = CieloCore.processingPlan(parsed, fee, selectedRows); } catch (_) {}
    }
    $("titles").textContent = summary.titles.toLocaleString("pt-BR");
    $("gross").textContent = CieloCore.moneyBR(summary.gross);
    $("adminFee").textContent = CieloCore.moneyBR(summary.fee);
    $("totalClear").textContent = CieloCore.moneyBR(summary.net);
    $("noteFee").textContent = CieloCore.moneyBR(fee);
    $("cielo04Total").textContent = plan ? CieloCore.moneyBR(plan.cielo04) : "—";
    $("establishments").textContent = summary.establishments.join(", ");
    $("cielo04AllocationTotal").textContent = plan ? CieloCore.moneyBR(plan.cielo04) : "—";
  }

  function showError(msg) {
    $("errorBox").textContent = msg;
    show("errorBox");
  }

  function toggleDownloads() {
    let ok = false;
    try {
      if (parsed && selectedRows.length && confirmBox.checked) {
        const plan = getPlan();
        ok = Math.abs(plan.notaDebito - parseFee()) < 0.001;
      }
    } catch (_) {}
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

  $("autoSelectBtn").addEventListener("click", selectAutomatic);
  $("allocationSearch").addEventListener("input", renderAllocation);

  confirmBox.addEventListener("change", toggleDownloads);

  downloadTxt.addEventListener("click", ()=>{
    if (!parsed || !confirmBox.checked) return;
    try {
      const txt = CieloCore.buildCielo04(parsed, parseFee(), allocationRows());
      downloadText(
        "CIELO04D_" + CieloCore.CONFIG.primaryEstablishment + "_IMPORTACAO.TXT",
        txt,
        "text/plain;charset=windows-1252"
      );
    } catch(e) { showError(e.message || String(e)); }
  });

  downloadControl.addEventListener("click", ()=>{
    if (!parsed || !confirmBox.checked) return;
    try {
      const report = CieloCore.buildControlReport(parsed, parseFee(), allocationRows());
      downloadText(
        "CONTROLE_NOTA_DEBITO_" + sourceName + ".txt",
        report,
        "text/plain;charset=utf-8"
      );
    } catch(e) { showError(e.message || String(e)); }
  });

  fileInput.addEventListener("change", ()=>{
    $("fileName").textContent = fileInput.files[0] ? fileInput.files[0].name : "Nenhum arquivo selecionado";
  });

  feeInput.addEventListener("change", () => {
    if (parsed) selectAutomatic();
  });
})();
