# Revisão de segurança — Nexumpedia 0.9.0

Data: 26 de setembro de 2026.

## Escopo

Esta revisão cobre autenticação, sessão, autorização, CSRF, uploads, renderização, headers HTTP, limites de requisição, backup, logs, dependências e configuração de staging.

## Correções aplicadas na 0.9.0

### Uploads

O backend deixou de confiar apenas no MIME declarado pelo cliente. Antes de persistir uma imagem, a aplicação agora confere a assinatura binária de JPEG, PNG, GIF ou WebP.

Há um teste E2E específico que envia um arquivo textual declarando-se como PNG e exige rejeição.

### Content Security Policy

O último estilo inline dos templates foi removido. A política agora usa scripts e estilos do próprio site. O JSON-LD recebe um nonce aleatório por requisição.

O CI verifica que templates EJS não reintroduzam handlers JavaScript ou atributos de estilo inline.

### Staging e indexação

`PUBLIC_INDEXING=false` é o comportamento padrão e também está configurado no staging.

Nesse modo:

- páginas usam `noindex,nofollow`;
- `robots.txt` bloqueia crawling;
- `sitemap.xml` não é disponibilizado.

## Controles verificados automaticamente

O CI cobre headers de segurança, CSP, request IDs, health checks, sintaxe, templates, banco, fluxo editorial, upload falsificado, auditoria de dependências, testes E2E e verificações automatizadas WCAG.

## Riscos residuais para avaliar antes da 1.0

- o rate limiting atual é local a cada processo; múltiplas instâncias devem usar armazenamento compartilhado;
- a validação de imagem confere assinatura, mas não faz re-encode completo nem remove metadados;
- MFA ainda não está disponível para contas administrativas;
- o repositório ainda não possui lockfile versionado, então a 1.0 deve fechar a reprodutibilidade das dependências.

A revisão deve ser repetida depois dos testes no staging real.
