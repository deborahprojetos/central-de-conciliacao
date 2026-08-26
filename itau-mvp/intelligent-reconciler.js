/* MVP V20 - adaptador do motor flexível de pagamentos.
   1x1, 1xN, Nx1 e NxN são possibilidades avaliadas a cada execução.
   Nenhum fornecedor recebe regra fixa de agrupamento. */
(() => {
  'use strict';

  function adaptResult(r) {
    const bank = Array.isArray(r.sourceBankRows) ? r.sourceBankRows : [];
    const dealer = Array.isArray(r.matchedTitles) ? r.matchedTitles : [];
    let status = r.status;
    if (status === 'ok' || status === 'grouped') status = 'CONCILIADO';
    else if (status === 'difference') status = 'DIVERGENCIA';
    else if (status === 'missing') status = 'ITAU_SEM_DEALER';
    else if (status === 'dealerOnly') status = 'DEALER_SEM_ITAU';

    return {
      itau: bank,
      dealer,
      status,
      type: r.method || r.reason || '',
      difference: Number(r.difference || 0),
      groupShape: r.groupShape || `${bank.length}×${dealer.length}`,
      raw: r
    };
  }

  function reconcile(itauInput, dealerInput, options = {}) {
    if (!window.ReconcilerCore || typeof window.ReconcilerCore.reconcilePayments !== 'function') {
      throw new Error('Motor de conciliação não foi carregado.');
    }

    const raw = window.ReconcilerCore.reconcilePayments(itauInput || [], dealerInput || [], {
      tolerance: options.tolerance ?? 0.011,
      maxGroup: options.maxGroup ?? 20,
      maxSubset: options.maxSubset ?? 12
    });

    const adaptedResults = raw.results.map(adaptResult);
    const matches = adaptedResults.filter(x => x.status === 'CONCILIADO');
    const differences = adaptedResults.filter(x => x.status === 'DIVERGENCIA');
    const itauSem = adaptedResults.filter(x => x.status === 'ITAU_SEM_DEALER');
    const dealerSem = (raw.dealerOnly || []).map(adaptResult);

    return {
      matches,
      differences,
      itauSem,
      dealerSem,
      all: [...matches, ...differences, ...itauSem, ...dealerSem],
      totals: raw.totals
    };
  }

  window.IntelligentReconciler = { reconcile };
})();
