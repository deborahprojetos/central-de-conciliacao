DIFAL - CONCILIAÇÃO BANCO UTIL x DEALER
VERSÃO FINAL 1.0.2

PUBLICAÇÃO NO NETLIFY
1. Descompacte o ZIP.
2. No Netlify, faça o deploy manual da pasta descompactada "difal-final".
3. Abra o endereço publicado.

FLUXO
1. Selecione a planilha do Banco Util.
2. Escolha a data da conferência.
3. Copie a relação do Dealer e cole no campo indicado.
4. Confira se a quantidade de linhas reconhecidas faz sentido.
5. Clique em ANALISAR DIA.
6. Use a lista DEALER para pesquisar os documentos que ainda precisam de baixa.

REGRAS
- Banco Util: Data do pagamento + Nº do documento + Valor total.
- Quando existirem, a aplicação mantém apenas Tipo do lançamento = Pagamento e Status = Efetivado.
- Dealer: Data Pagto Dia + Nº/Parcela + Valor Pagto Dia.
- O número antes de / ou - no campo Nº/Parcela é tratado como Nº do documento.
- Correspondência é 1:1. Uma linha do Dealer nunca pode conciliar mais de uma linha do Banco Util.
- Mesmo documento e mesmo valor: OK.
- Mesmo documento e valor diferente: DIVERGÊNCIA.
- Documento Banco Util não encontrado no Dealer: DEALER.
- Linha existente no Dealer sem Banco Util: alerta separado.

RECURSOS
- Histórico por data salvo no navegador.
- Status NÃO ANALISADO / OK / DIVERGÊNCIA / DEALER.
- Filtro apenas das diferenças.
- Copiar documentos DEALER.
- Exportar conferência da data para Excel.
- Exportar controle completo do período para Excel.
- Backup e restauração do controle em JSON.
- Opção explícita para confirmar que o Dealer está vazio em uma data.
- Diagnóstico de linhas coladas do Dealer que não foram reconhecidas.

PRIVACIDADE
O processamento da planilha, do texto do Dealer e do histórico ocorre no navegador.
A aplicação não possui banco de dados ou backend próprio.

DEPENDÊNCIA
A leitura e geração de arquivos Excel usa SheetJS 0.20.3 carregado pelo CDN oficial.
É necessária conexão de internet para carregar essa biblioteca ao abrir o site.

CORREÇÃO 1.0.2
- Corrigido erro de interface após a leitura da planilha (hydrateFromState is not defined).
- O arquivo Veiculos.xlsx foi validado: aba Extrato, 596 pagamentos válidos.
- Cache dos arquivos da aplicação configurado para revalidação imediata após novo deploy.


AJUSTES 1.0.2
- Mostra se a base foi carregada agora, restaurada do navegador ou restaurada de backup.
- Exibe data/hora da última importação da planilha.
- Período completo sem reticências.
- Progresso exibido como X de Y datas.
- Mantém a troca automática de período ao selecionar uma nova planilha.
