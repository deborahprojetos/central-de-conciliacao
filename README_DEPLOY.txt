CENTRAL FINANCEIRA v1.5
========================

MÓDULOS
-------
- /cielo/       Gerador CIELO04
- /difal/       Conciliação DIFAL v1.0.2
- /itau-dealer/ Conciliação Itaú × Dealer V6 PDF/OCR validada

ACESSO
------
A Central inteira está protegida por autenticação executada no Netlify Edge.

Login autorizado:
- e-mail: deborahfinancas@gmail.com
- senha: a senha fornecida para esta versão

A senha NÃO fica no JavaScript público das aplicações.
A autenticação cria uma sessão HttpOnly com validade de 8 horas.

PUBLICAÇÃO
----------
Este pacote contém:
- public/                 arquivos publicados do site
- netlify/edge-functions/ autenticação server-side
- netlify.toml            configuração do deploy

Para que o login funcione, faça o deploy estando logado no Netlify e envie
o PROJETO COMPLETO (este ZIP), não somente a pasta public.

OBSERVAÇÃO DE SEGURANÇA
-----------------------
A autenticação é feita no Edge antes de liberar páginas e arquivos.
Não é apenas uma tela de login criada no navegador.

O projeto também inclui:
- noindex/noarchive
- cookie Secure + HttpOnly + SameSite=Strict
- sessão com expiração
- botão Sair


ATUALIZAÇÃO v1.4
----------------
- Itaú × Dealer substituído pela versão V5 OCR CORRIGIDO.
- Corrigido o fluxo que podia ficar travado em “PDF em imagem detectado. Iniciando OCR...”.
- Botão Analisar permanece bloqueado enquanto o PDF ainda está sendo processado.
- Cielo e DIFAL foram mantidos.
- Login obrigatório e sessão da Central foram mantidos.


ATUALIZAÇÃO v1.5
----------------
- Itaú × Dealer substituído pela versão V6 PDF/OCR VALIDADO.
- Cielo mantido.
- DIFAL mantido.
- Login obrigatório e sessão da Central mantidos.
