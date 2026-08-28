/* MVP V23 - adaptador de status para visualização única. */
(() => {
  'use strict';

  function adaptResult(r) {
    const bank = Array.isArray(r.sourceBankRows) ? r.sourceBankRows : [];
    const dealer = Array.isArray(r.matchedTitles) ? r.matchedTitles : [];
    let status = r.status;
    if (status === 'ok') status = 'CONCILIADO';
    else if (status === 'grouped') status = 'CONCILIADO_AGRUPADO';
    else if (status === 'value') status = 'CONCILIADO_VALOR';
    else if (status === 'partial' || status === 'difference') status = 'ENCONTRADO_PARCIAL';
    else if (status === 'review') status = 'ANALISAR_CONCILIACAO';
    else if (status === 'missing' || status === 'dealerOnly') status = 'NAO_ENCONTRADO';

    return {
      itau: bank,
      dealer,
      status,
      type: r.method || r.reason || '',
      reason: r.reason || '',
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

    const bankResults = raw.results.map(adaptResult);
    const dealerOnly = (raw.dealerOnly || []).map(adaptResult);
    const all = [...bankResults, ...dealerOnly];
    const byStatus = status => all.filter(x => x.status === status);

    return {
      all,
      conciliado: byStatus('CONCILIADO'),
      agrupado: byStatus('CONCILIADO_AGRUPADO'),
      valor: byStatus('CONCILIADO_VALOR'),
      analisar: byStatus('ANALISAR_CONCILIACAO'),
      parcial: byStatus('ENCONTRADO_PARCIAL'),
      naoEncontrado: byStatus('NAO_ENCONTRADO'),
      totals: raw.totals
    };
  }

  window.IntelligentReconciler = { reconcile };
})();
