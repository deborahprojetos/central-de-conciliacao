CIELO → DEALER | WEB v0.2 COMPLETO
===================================

REGRA DE PARCELA CONFIRMADA
---------------------------
No registro E do CIELO04:
- posições 18–19 (1-based): parcela atual
- posições 20–21 (1-based): total de parcelas

Exemplo:
Parcela 1 de 2 -> 0102
Parcela 2 de 2 -> 0202
Parcela 2 de 6 -> 0206

O erro anterior gravava parcela atual também como total:
parcela 1 de 2 -> 0101 (INCORRETO)

REGRA DA TAXA DE ANTECIPAÇÃO
----------------------------
A taxa de antecipação NÃO é abatida de nenhum título no CIELO04.
A aplicação apenas localiza um título com valor suficiente e sinaliza:
"baixar a Nota de Débito manualmente neste título/parcela".

ENTRADA
-------
Arquivo Excel original da Cielo, contendo:
Data de pagamento
Data do lançamento
Estabelecimento
Código da autorização
NSU/DOC
Número da parcela
Valor bruto
Taxa/tarifa
Valor líquido

Não é necessário:
- Valor Líquido Importação
- preencher Taza antecipação

SAÍDAS
------
1. CIELO04D_1029654848_IMPORTACAO.TXT
2. CONTROLE_NOTA_DEBITO_<arquivo>.txt

PUBLICAÇÃO NETLIFY
------------------
Arraste este ZIP para um novo deploy manual no projeto Cielo do Netlify.
Não requer Python nem instalação local.

OBSERVAÇÃO
----------
A configuração desta versão foi validada para o fluxo France /
estabelecimento principal 1029654848.


ATUALIZAÇÃO v0.3
Total a baixar = Nota de Débito manual + CIELO04. O título escolhido entra no CIELO04 apenas pelo saldo após a Nota de Débito.
