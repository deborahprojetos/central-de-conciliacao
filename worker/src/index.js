export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({status:'ok', service:'conciliacao-ocr'}), {
        headers:{'content-type':'application/json'}
      });
    }
    return new Response(JSON.stringify({
      error:'Worker preparado. OCR será conectado na próxima etapa.'
    }), {
      status:501,
      headers:{'content-type':'application/json'}
    });
  }
};
