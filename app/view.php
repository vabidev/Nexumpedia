<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

function render_header(string $title, bool $showSearch = true): void
{
    $user = current_user();
    $needsInstall = !has_users();
    $fullTitle = $title === 'Nexumpedia' ? 'Nexumpedia — Conhecimento em conexão' : h($title) . ' — Nexumpedia';
    ?>
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title><?= $fullTitle ?></title>
  <meta name="description" content="Nexumpedia, uma enciclopédia digital de conteúdo editorial revisado.">
  <link rel="icon" href="assets/img/nexumpedia-mark.svg">
  <link rel="stylesheet" href="assets/css/nexumpedia.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="index.php" aria-label="Nexumpedia, página principal">
    <img src="assets/img/nexumpedia-mark.svg" alt="">
    <span><span class="brand-name">Nexumpedia</span><span class="brand-tagline">CONHECIMENTO EM CONEXÃO</span></span>
  </a>

  <?php if ($showSearch): ?>
  <form class="search" role="search" method="get" action="index.php">
    <input type="search" name="q" aria-label="Pesquisar na Nexumpedia" placeholder="Pesquisar na Nexumpedia" value="<?= h($_GET['q'] ?? '') ?>">
    <button>Pesquisar</button>
  </form>
  <?php else: ?><div></div><?php endif; ?>

  <nav class="usernav" aria-label="Conta">
    <?php if ($needsInstall): ?>
      <a href="install.php">Instalar</a>
    <?php elseif ($user): ?>
      <a class="hide-md" href="painel.php"><?= h($user['display_name']) ?></a>
      <a href="logout.php">Sair</a>
    <?php else: ?>
      <a href="login.php">Entrar</a>
    <?php endif; ?>
    <button class="icon-btn" data-theme-toggle aria-label="Alternar tema">◐</button>
    <button class="icon-btn mobile-menu" data-menu-toggle aria-label="Abrir menu">☰</button>
  </nav>
</header>
<?php
    foreach (flashes() as $flash):
        $type = $flash['type'] === 'error' ? 'error' : ($flash['type'] === 'success' ? 'success' : 'info');
?>
<div class="flash <?= h($type) ?>"><?= h($flash['message']) ?></div>
<?php
    endforeach;
}

function render_public_sidebar(): void
{
    ?>
<aside class="sidebar" aria-label="Navegação">
  <div class="nav-block">
    <div class="nav-title">Navegação</div>
    <ul class="nav-list">
      <li><a href="index.php">Página principal</a></li>
      <li><a href="index.php?featured=1">Conteúdo em destaque</a></li>
      <li><a href="aleatorio.php">Página aleatória</a></li>
      <li><a href="sobre.php">Sobre a Nexumpedia</a></li>
    </ul>
  </div>
  <div class="nav-block">
    <div class="nav-title">Explorar</div>
    <ul class="nav-list">
      <li><a href="index.php">Índice de artigos</a></li>
      <li><a href="index.php?q=">Pesquisar</a></li>
    </ul>
  </div>
</aside>
<?php
}

function render_footer(): void
{
    ?>
<script src="assets/js/nexumpedia.js"></script>
</body>
</html>
<?php
}
