<?php
declare(strict_types=1);

require_once __DIR__ . '/app/view.php';

$q = trim((string)($_GET['q'] ?? ''));
$params = [];
$sql = "SELECT a.id, a.slug, a.title, a.summary, a.published_at, a.updated_at, u.display_name AS author
        FROM articles a
        JOIN users u ON u.id = a.author_id
        WHERE a.status = 'published'";

if ($q !== '') {
    $sql .= ' AND (a.title LIKE ? OR a.summary LIKE ? OR a.content LIKE ?)';
    $term = '%' . $q . '%';
    $params = [$term, $term, $term];
}

$sql .= ' ORDER BY COALESCE(a.published_at, a.updated_at) DESC, a.title ASC LIMIT 50';
$stmt = db()->prepare($sql);
$stmt->execute($params);
$articles = $stmt->fetchAll();

render_header('Nexumpedia');
?>
<div class="page">
  <?php render_public_sidebar(); ?>

  <main class="article">
    <section class="home-hero">
      <div>
        <h1><?= $q !== '' ? 'Resultados da pesquisa' : 'Bem-vindo à Nexumpedia' ?></h1>
        <p><?= $q !== '' ? 'Resultados para “' . h($q) . '”.' : 'Uma enciclopédia digital construída sobre pesquisa, revisão e responsabilidade editorial.' ?></p>
      </div>
      <?php if ($q === ''): ?><div class="meta"><?= count($articles) ?> artigo(s) publicado(s)</div><?php endif; ?>
    </section>

    <?php if (!has_users()): ?>
      <div class="notice"><strong>Primeira execução.</strong> A Nexumpedia ainda não possui administrador. <a href="install.php">Concluir instalação →</a></div>
    <?php endif; ?>

    <?php if ($q === '' && $articles): ?>
      <?php $featured = $articles[0]; ?>
      <section class="card">
        <div class="card-title">Artigo em destaque</div>
        <div class="card-body">
          <h3 style="margin-top:0"><a href="artigo.php?slug=<?= urlencode($featured['slug']) ?>"><?= h($featured['title']) ?></a></h3>
          <p><?= h($featured['summary']) ?></p>
          <p class="meta">Publicado por <?= h($featured['author']) ?> · <?= h(format_date($featured['published_at'])) ?></p>
          <a href="artigo.php?slug=<?= urlencode($featured['slug']) ?>">Ler artigo →</a>
        </div>
      </section>
    <?php endif; ?>

    <section class="card">
      <div class="card-title"><?= $q !== '' ? 'Resultados' : 'Artigos publicados' ?></div>
      <div class="card-body">
        <?php if (!$articles): ?>
          <p>Nenhum artigo encontrado.</p>
        <?php else: ?>
          <ul class="article-list article-index">
            <?php foreach ($articles as $article): ?>
              <li>
                <a href="artigo.php?slug=<?= urlencode($article['slug']) ?>"><strong><?= h($article['title']) ?></strong></a>
                <?php if ($article['summary']): ?> — <?= h($article['summary']) ?><?php endif; ?>
                <div class="meta">Atualizado em <?= h(format_date($article['updated_at'])) ?></div>
              </li>
            <?php endforeach; ?>
          </ul>
        <?php endif; ?>
      </div>
    </section>

    <footer class="footer">Nexumpedia — Conhecimento em conexão.</footer>
  </main>

  <aside class="toc-side">
    <div class="nav-title">Nesta página</div>
    <a href="index.php">Início</a>
    <a href="#artigos">Artigos</a>
  </aside>
</div>
<?php render_footer(); ?>
