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
- referências estruturadas por artigo;
- citações inline com sintaxe `[^chave]`;
- seção de referências gerada automaticamente;
- fontes preservadas no histórico de versões;
- validação de citações sem fonte cadastrada;
- infoboxes configuráveis por artigo;
- imagem opcional da biblioteca de mídia nas infoboxes;
- até 20 pares campo/valor por infobox;
- infobox preservada no histórico de versões;
- pré-visualização completa sem salvar;
- visualização individual de versões históricas;
- comparação textual e estruturada entre versões;
- restauração de versão como uma nova revisão;
- fila editorial de revisões pendentes;
- rodadas de revisão independentes e preservadas;
- conversa entre colaborador e administrador por rodada;
- aprovação com publicação;
- rejeição com pedido de ajustes e parecer obrigatório;
- histórico de pareceres e revisores;
- rate limiting global, de escrita e autenticação;
- Content Security Policy sem JavaScript inline;
- request ID em cada solicitação e nos erros;
- troca de senha com encerramento de sessões;
- redefinição administrativa de senha;
- backup administrativo completo em JSON;
- health checks de liveness e readiness;
- encerramento gracioso em SIGTERM/SIGINT;
- Dockerfile e Procfile para deploy;
- Playwright E2E no Chromium;
- axe/WCAG automatizado no CI;
- canonical, Open Graph e JSON-LD;
- robots.txt e sitemap.xml dinâmicos;
- staging isolado via Render Blueprint;
- proteção noindex para staging;
- validação de assinatura binária em uploads;
- auditoria automática de dependências de produção;
- instalação do primeiro administrador;
- primeiro acesso controlado por /login;
- URL privada individual de login após o primeiro acesso;
- rota privada armazenada somente como HMAC-SHA-256;
- reset administrativo da URL privada;
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
SITE_URL=https://www.exemplo.com
PUBLIC_INDEXING=false
```

Em produção, `SESSION_SECRET` e `LOGIN_PATH_SECRET` precisam ter pelo menos 32 caracteres. Use HTTPS no proxy/host da aplicação; cookies de sessão ficam marcados como Secure em produção.

Mantenha `PUBLIC_INDEXING=false` em desenvolvimento e staging. No domínio público oficial, configure `SITE_URL` com a URL canônica e então habilite `PUBLIC_INDEXING=true`.

## Versão atual

**0.9.1** — hardening de autenticação com rota privada individual de login após o primeiro acesso.

## Infoboxes

O editor permite adicionar uma infobox opcional a qualquer artigo. Ela pode conter:

- título próprio;
- imagem já existente na biblioteca de mídia;
- legenda;
- até 20 pares de campo e valor.

A infobox é genérica, então pode ser usada em artigos sobre pessoas, países, softwares, empresas, eventos e outros temas sem exigir um tipo específico de formulário.

Cada versão salva guarda um snapshot da infobox daquele momento.

## Pré-visualização e histórico

O editor possui uma pré-visualização completa que abre sem gravar alterações. Ela renderiza o conteúdo enviado pelo formulário com infobox, categorias, imagens, citações e referências.

O histórico permite:

- abrir qualquer versão disponível à conta atual;
- comparar duas versões;
- visualizar diferenças de título, resumo, conteúdo e categorias;
- comparar também snapshots de fontes e infobox;
- restaurar uma versão antiga como uma **nova versão**, sem apagar o histórico anterior.

A restauração preserva o estado editorial atual do artigo. Em um artigo publicado, um administrador deve considerar que a restauração altera o conteúdo atual imediatamente.

## Revisão editorial

Cada envio para revisão cria uma **rodada própria**, preservada mesmo depois de encerrada.

Durante uma rodada pendente:

- o colaborador pode deixar uma nota de envio;
- autor e administrador podem conversar em comentários;
- administradores veem todas as pendências em `/revisoes`;
- o administrador pode aprovar e publicar;
- ou pode devolver o artigo para rascunho pedindo ajustes, com parecer obrigatório.

Se o colaborador voltar a salvar o artigo como rascunho enquanto uma revisão está pendente, a rodada é cancelada automaticamente. Ao reenviar depois dos ajustes, uma nova rodada é criada, preservando a anterior.

## Fluxo editorial

1. O primeiro administrador é criado em `/install` e define sua URL privada de acesso.
2. Administradores podem criar outras contas.
3. Uma conta nova usa `/login` somente no primeiro acesso e depois define sua própria URL privada.
4. Colaboradores criam artigos como rascunho.
5. O artigo é enviado para uma rodada de revisão.
6. Autor e revisor podem conversar dentro da rodada.
7. O administrador aprova/publica ou devolve para ajustes.
8. Cada decisão editorial gera uma nova versão no histórico.
9. Colaboradores não alteram diretamente um artigo já publicado.

## Formatação dos artigos

```text
## Seção
### Subseção
**negrito**
*itálico*
- item de lista
[link](https://exemplo.com)
[^ibge2026]
![Descrição](/media/123)
```

### Referências e citações

As fontes são cadastradas no editor com uma chave curta, título e metadados opcionais como autor, publicação, URL e datas.

Exemplo de chave:

```text
ibge2026
```

No conteúdo, a citação é inserida assim:

```text
O dado apresentado aqui precisa de uma fonte.[^ibge2026]
```

A página publicada converte a marcação em uma nota numerada e cria a seção **Referências** automaticamente. O salvamento é bloqueado quando existe uma citação no texto sem a fonte correspondente cadastrada.

A biblioteca de mídia gera o código da imagem automaticamente.

## Estrutura principal

- `src/server.js` — aplicação Express e rotas;
- `src/db.js` — conexão, schema e migrações PostgreSQL;
- `src/auth.js` — autenticação, sessão, CSRF e permissões;
- `src/helpers.js` — renderização segura, slugs e helpers;
- `views/` — templates EJS;
- `assets/` — CSS, JavaScript e marca;
- `scripts/check-views.js` — validação dos templates;
- `scripts/check-citations.js` — testes do renderizador de citações;
- `scripts/check-history.js` — testes de diff e snapshots históricos;
- `scripts/check-review.js` — valida uma rodada editorial completa no PostgreSQL;
- `scripts/check-security.js` — sobe a aplicação e valida CSP, headers, request IDs, health checks e ausência de JavaScript/estilo inline;
- `scripts/check-seo.js` — valida canonical, JSON-LD, robots e sitemap no modo indexável;
- `scripts/e2e-seed.js` — prepara estado isolado para o E2E;
- `tests/e2e/` — fluxos Playwright, acessibilidade com axe e testes de segurança;
- `scripts/check-db.js` — sobe o schema e valida as migrações PostgreSQL no CI;
- `docker-compose.yml` — PostgreSQL para desenvolvimento local;
- `render.yaml` — staging Node.js + PostgreSQL;
- `docs/STAGING.md` — procedimento do staging;
- `docs/SECURITY_REVIEW_0.9.md` — revisão de segurança desta versão.

## Hospedagem

A aplicação escuta `process.env.PORT` e `0.0.0.0`, então está preparada para plataformas de hospedagem Node.js. Para uma hospedagem gratuita com filesystem efêmero, use um PostgreSQL persistente externo por meio de `DATABASE_URL`.

Nesta fase as imagens são armazenadas no próprio PostgreSQL. Para uma biblioteca muito grande, o próximo passo será migrar a mídia para armazenamento de objetos compatível com S3, sem mudar a interface editorial.

## Produção e segurança

Já estão aplicados:

- cookies HttpOnly, SameSite e Secure em produção;
- sessões armazenadas no PostgreSQL;
- CSRF;
- bcrypt para senhas;
- política de senha de 12+ caracteres com letra e número para novas senhas;
- encerramento das sessões após troca ou reset de senha;
- consultas parametrizadas;
- escape de saída em EJS;
- renderizador de artigo restrito a uma marcação simples;
- limite de 5 MB e lista de MIME permitidos nos uploads;
- Helmet com Content Security Policy;
- JavaScript inline removido dos templates;
- rate limiting global, de autenticação e operações de escrita;
- request IDs propagados no header `X-Request-Id`;
- logs de erro com request ID;
- validação de segredo de sessão em produção;
- URL privada de login por usuário, com HMAC-SHA-256 e pepper separado;
- /login limitado a contas que ainda estão no primeiro acesso;
- ausência de link público para autenticação;
- liveness em `/health/live`;
- readiness do PostgreSQL em `/health/ready`;
- encerramento gracioso em SIGTERM/SIGINT.

### Login privado

Depois do primeiro acesso, cada usuário define uma rota privada própria na raiz do site. Exemplo:

```text
https://exemplo.com/nevoa-azul-7k3f9p2m...
```

O valor da rota não é salvo em texto puro. O banco armazena somente um HMAC-SHA-256 usando `LOGIN_PATH_SECRET`.

O endpoint `/login` só autentica contas que ainda não configuraram a rota privada. Quando não existe nenhuma conta pendente de primeiro acesso, ele responde 404.

A URL privada reduz varreduras e ataques oportunistas, mas não substitui senha, rate limiting e os demais controles de autenticação.

Se o usuário esquecer a rota, um administrador pode resetá-la na página de usuários. Isso encerra as sessões existentes e reabre o primeiro acesso por `/login`.

### Senhas

Usuários autenticados podem trocar a própria senha em `/conta`. A troca invalida as sessões existentes.

Administradores podem redefinir a senha de outras contas pela página de usuários. Isso também encerra todas as sessões antigas da conta redefinida.

Nesta versão, a recuperação não depende de e-mail: ela é feita administrativamente. Integração com provedor de e-mail pode ser adicionada em uma versão futura.

### Backup

Administradores podem baixar um backup pela página `/usuarios`.

O arquivo contém:

- usuários e hashes de senha;
- artigos e versões;
- categorias;
- referências;
- infoboxes;
- mídia codificada em Base64;
- revisões e comentários.

Sessões ativas não entram no backup. O download usa uma transação PostgreSQL de leitura repetível para manter o snapshot consistente.

**O backup é sensível.** Armazene-o fora do servidor da aplicação e em local privado.

### Deploy

A aplicação pode rodar diretamente em hosts Node.js com:

```bash
npm install
npm start
```

Também existem:

- `Procfile` com o processo web;
- `Dockerfile` baseado em Node 22 Alpine;
- healthcheck do container apontando para `/health/ready`.

O host precisa fornecer `DATABASE_URL`, `SESSION_SECRET`, `LOGIN_PATH_SECRET`, `NODE_ENV=production` e `PORT` quando exigido pela plataforma.

---

Nexumpedia — Conhecimento em conexão.


## Testes E2E e acessibilidade

Para executar localmente, com o PostgreSQL configurado:

```bash
npm install
npx playwright install chromium
npm run e2e
```

O E2E cobre leitura pública, criação de colaborador, criação de artigo, envio para revisão, aprovação/publicação e rejeição de arquivo de imagem falsificado.

O CI também roda axe nas páginas principal, artigo público e login para detectar automaticamente problemas cobertos pelas regras WCAG A/AA. Testes automatizados não substituem revisão manual de acessibilidade.

## SEO

Quando `PUBLIC_INDEXING=true`, a Nexumpedia disponibiliza canonical URLs, Open Graph, JSON-LD, `robots.txt` e `sitemap.xml`.

Quando `PUBLIC_INDEXING=false`, páginas recebem `noindex,nofollow`, o robots bloqueia crawling e o sitemap não é exposto. O JSON-LD continua presente para permitir validação no staging.

## Staging

O arquivo `render.yaml` define o ambiente `nexumpedia-staging` e seu PostgreSQL isolado. O deploy automático usa `checksPass`, portanto uma alteração só é enviada ao staging depois que o GitHub Actions termina com sucesso.

Consulte `docs/STAGING.md` antes do primeiro deploy.
