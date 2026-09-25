# Nexumpedia

**Conhecimento em conexão.**

A Nexumpedia é uma enciclopédia digital com identidade própria e interface clássica de leitura. O conteúdo público é produzido por **administradores e colaboradores autorizados**, em vez de edição aberta por qualquer visitante.

## Stack

- Node.js 22+
- Express 5
- EJS
- PostgreSQL
- `pg`
- sessões persistidas no PostgreSQL
- uploads de imagem persistidos no PostgreSQL nesta fase
- CSS/JavaScript próprios da Nexumpedia

A aplicação não depende do disco do servidor para guardar banco ou mídia. Isso é importante em hospedagens gratuitas que usam filesystem efêmero.

## Funcionalidades atuais

- página inicial e pesquisa em artigos publicados;
- páginas públicas de artigo;
- categorias normalizadas de artigos;
- navegação e pesquisa por categoria;
- categorias registradas no histórico de versões;
- instalação do primeiro administrador;
- login e sessões;
- papéis de **administrador** e **colaborador**;
- painel editorial;
- criação e edição de artigos;
- estados de **rascunho**, **em revisão**, **publicado** e **arquivado**;
- publicação restrita a administradores;
- histórico automático de versões;
- criação e ativação/desativação de colaboradores;
- biblioteca de imagens;
- upload validado de JPG, PNG, WebP e GIF;
- CSRF nos formulários;
- senhas com bcrypt;
- consultas parametrizadas no PostgreSQL;
- modo claro/escuro e layout responsivo;
- validação automática de JavaScript e templates EJS no GitHub Actions.

## Executar localmente

### 1. Suba o PostgreSQL

Com Docker:

```bash
docker compose up -d
```

### 2. Configure as variáveis

```bash
cp .env.example .env
```

O arquivo de exemplo já aponta para o PostgreSQL criado pelo `docker-compose.yml`.

### 3. Instale as dependências

```bash
npm install
```

### 4. Inicie a aplicação

```bash
npm run dev
```

Abra:

```text
http://127.0.0.1:3000
```

Na primeira execução, acesse `/install` para criar a conta administradora principal. Depois disso, a instalação fica bloqueada automaticamente.

## Variáveis de ambiente

```text
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://nexumpedia:nexumpedia@127.0.0.1:5432/nexumpedia
SESSION_SECRET=uma-chave-longa-e-aleatoria
```

Em produção, `SESSION_SECRET` precisa ter pelo menos 32 caracteres.

## Versão atual

**0.3.0** — categorias implementadas de ponta a ponta.

## Fluxo editorial

1. O primeiro administrador é criado em `/install`.
2. Administradores podem criar outras contas.
3. Colaboradores criam artigos como rascunho.
4. O artigo pode ser enviado para revisão.
5. Administradores revisam e publicam.
6. Cada salvamento gera uma versão no histórico.
7. Colaboradores não alteram diretamente um artigo já publicado.

## Formatação dos artigos

```text
## Seção
### Subseção
**negrito**
*itálico*
- item de lista
[fonte](https://exemplo.com)
![Descrição](/media/123)
```

A biblioteca de mídia gera o código da imagem automaticamente.

## Estrutura principal

- `src/server.js` — aplicação Express e rotas;
- `src/db.js` — conexão, schema e migrações PostgreSQL;
- `src/auth.js` — autenticação, sessão, CSRF e permissões;
- `src/helpers.js` — renderização segura, slugs e helpers;
- `views/` — templates EJS;
- `assets/` — CSS, JavaScript e marca;
- `scripts/check-views.js` — validação dos templates;
- `docker-compose.yml` — PostgreSQL para desenvolvimento local.

## Hospedagem

A aplicação escuta `process.env.PORT` e `0.0.0.0`, então está preparada para plataformas de hospedagem Node.js. Para uma hospedagem gratuita com filesystem efêmero, use um PostgreSQL persistente externo por meio de `DATABASE_URL`.

Nesta fase as imagens são armazenadas no próprio PostgreSQL. Para uma biblioteca muito grande, o próximo passo será migrar a mídia para armazenamento de objetos compatível com S3, sem mudar a interface editorial.

## Segurança

Já estão aplicados:

- cookies HttpOnly, SameSite e Secure em produção;
- sessões armazenadas no PostgreSQL;
- CSRF;
- bcrypt para senhas;
- consultas parametrizadas;
- escape de saída em EJS;
- renderizador de artigo restrito a uma marcação simples;
- limite de 5 MB e lista de MIME permitidos nos uploads;
- `helmet`;
- rate-limit básico de tentativas de login por sessão;
- validação de segredo de sessão em produção.

---

Nexumpedia — Conhecimento em conexão.
