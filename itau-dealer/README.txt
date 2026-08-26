CONCILIAÇÃO ITAÚ × DEALER — V6 PDF/OCR

Correção principal desta versão:
- leitura de PDF do Itaú gerado por Microsoft Print to PDF, mesmo quando não existe camada de texto;
- OCR com tentativa principal e alternativa de carregamento;
- tempo de inicialização do OCR ampliado para conexões/navegadores mais lentos;
- pré-processamento da imagem para melhorar números pequenos;
- segunda leitura focada na faixa da tabela quando a página inteira não é reconhecida;
- parser mais tolerante a quebras de linha e erros comuns de OCR em 0/O e 1/I/l.

VALIDAÇÃO REALIZADA COM O ARQUIVO Cobrança(2).pdf:
5 recebimentos reconhecidos, total R$ 2.982,90.

Registros esperados no teste:
- MATEUS RAFAEL VIEIRA | 13/08/2026 | 204,68 | Seu número 0046504003
- MEC PRIME LTDA | 13/08/2026 | 120,22 | Seu número 0046542003
- MALU REPARACAO AUTOM | 13/08/2026 | 1.414,00 | Seu número 0047501001
- MALU REPARACAO AUTOM | 13/08/2026 | 959,00 | Seu número 0047502001
- CRT AUTO LIMA SERVIC | 13/08/2026 | 285,00 | Seu número 0047529001

Deploy: enviar o conteúdo deste ZIP ao Netlify.


ATUALIZAÇÃO v11 - MODO PAGAMENTOS
- Aceita Excel de pagamentos do Itaú (Data, Razão Social, Valor).
- Aceita Excel do Dealer com títulos, Dt. Movimento e Dt. Caixa.
- Reconhece 1 pagamento Itaú contra vários títulos Dealer por soma exata.
- Mantém correspondências por nome/entidade e data como evidência.
- Não força vínculo sem evidência mínima.
- O modo pagamentos não depende de OCR.
