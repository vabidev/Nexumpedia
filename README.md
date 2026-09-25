# Nexumpedia

**Conhecimento em conexão.**

A Nexumpedia é uma enciclopédia digital com identidade própria e interface clássica de leitura. O conteúdo público é produzido por **administradores e colaboradores autorizados**, em vez de edição aberta por qualquer visitante.

## Estado atual

A primeira versão funcional do backend já inclui:

- página inicial e pesquisa em artigos publicados;
- páginas públicas de artigo;
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
- proteção CSRF nos formulários;
- senhas armazenadas com `password_hash()`;
- banco SQLite com chaves estrangeiras;
- modo claro/escuro e layout responsivo;
- validação de sintaxe PHP no GitHub Actions.

## Requisitos

- PHP 8.2 ou superior;
- extensão PDO SQLite;
- extensão Fileinfo;
- permissão de escrita nas pastas `data/` e `uploads/`.

Não existem dependências de Composer ou Node.js nesta fase.

## Executar localmente

Clone o repositório e, na raiz do projeto:

```bash
php -S 127.0.0.1:8000 router.php
```

Depois abra:

```text
http://127.0.0.1:8000
```

Na primeira execução, a Nexumpedia direcionará para `install.php`, onde é criada a primeira conta administradora.

## Fluxo editorial

1. Um administrador cria contas de colaboradores.
2. Um colaborador cria um artigo como rascunho.
3. O artigo é enviado para revisão.
4. Um administrador revisa e publica.
5. Cada salvamento gera uma entrada no histórico.
6. Colaboradores não alteram diretamente artigos que já estão publicados.

## Formatação dos artigos

O editor usa uma marcação simples e segura:

```text
## Seção
### Subseção
**negrito**
*itálico*
- item de lista
[fonte](https://exemplo.com)
![Descrição](/uploads/arquivo.png)
```

A biblioteca de mídia fornece automaticamente o código de imagem para colar no artigo.

## Estrutura principal

- `app/bootstrap.php` — banco, autenticação, permissões e helpers;
- `app/view.php` — layout compartilhado;
- `index.php` — início e pesquisa;
- `artigo.php` — leitura de artigos;
- `painel.php` — painel editorial;
- `editor.php` — criação, revisão e publicação;
- `historico.php` — histórico de versões;
- `usuarios.php` — administração de contas;
- `midia.php` — biblioteca de imagens;
- `install.php` — instalação inicial;
- `assets/` — CSS, JavaScript e marca;
- `data/` — banco SQLite em tempo de execução;
- `uploads/` — mídia enviada pelos editores.

Os arquivos HTML anteriores permanecem no repositório apenas como referência do primeiro protótipo. A aplicação funcional utiliza as páginas `.php`.

## Segurança já aplicada

O projeto usa consultas preparadas, escape de saída, CSRF, cookies de sessão HttpOnly/SameSite, verificação de MIME em uploads e nomes aleatórios para arquivos enviados. As pastas internas possuem bloqueios para Apache e o roteador de desenvolvimento impede acesso direto ao banco e ao código interno.

Para produção, ainda será necessário configurar HTTPS, backups, limites do servidor, cabeçalhos HTTP e regras equivalentes caso o servidor utilizado seja Nginx.

---

Nexumpedia — Conhecimento em conexão.
