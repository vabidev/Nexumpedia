# Staging da Nexumpedia

A v0.9.0 inclui um `render.yaml` para um ambiente de staging isolado.

## Objetivo

O staging existe para validar o comportamento da aplicação fora do CI antes da 1.0. Ele usa uma aplicação Node.js e um PostgreSQL próprios.

## Proteção contra indexação

O staging define:

```text
PUBLIC_INDEXING=false
```

Com isso, a aplicação envia `noindex,nofollow`, bloqueia crawlers pelo `robots.txt` e não publica o sitemap.

## Recursos do Blueprint

O `render.yaml` cria:

- serviço web `nexumpedia-staging`;
- PostgreSQL `nexumpedia-staging-db`;
- `SESSION_SECRET` aleatória;
- `LOGIN_PATH_SECRET` aleatória;
- `DATABASE_URL` ligada ao banco;
- health check em `/health/ready`;
- deploy automático somente depois de os checks do GitHub passarem.

O banco não expõe acesso público no Blueprint (`ipAllowList: []`).

## Criação no Render

No painel do Render, crie um Blueprint a partir deste repositório e selecione o `render.yaml` da raiz.

Depois do primeiro deploy:

1. abra `/install` no endereço do staging;
2. crie a conta administradora de staging;
3. defina e salve a URL privada de acesso do administrador;
4. confirme que `/login` passa a responder 404;
5. crie um colaborador e valide o primeiro acesso por `/login`;
6. configure a URL privada do colaborador;
7. valide revisão e publicação;
8. confirme `/health/ready`;
9. confirme que `/robots.txt` contém `Disallow: /`.

Não reutilize senha, banco ou conteúdo sensível do ambiente público no staging.

## Produção futura

Quando existir um domínio público oficial, configure `SITE_URL` com a URL canônica e só então altere `PUBLIC_INDEXING=true`.
