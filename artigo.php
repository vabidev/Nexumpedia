<?php
declare(strict_types=1);

require_once __DIR__ . '/app/view.php';

$slug = trim((string)($_GET['slug'] ?? ''));
if ($slug === '') {
    http_response_code(404);
    render_header('Artigo não encontrado');
    echo '<main class="auth-shell"><section class="auth-card"><h1>Artigo não encontrado</h1><p>O endereço informado não identifica um artigo.</p></section></main>';
    render_footer();
    exit;
}

$stmt = db()->prepare("SELECT a.*, u.display_name AS author_name, r.display_name AS reviewer_name
                       FROM articles a
                       JOIN users u ON u.id = a.author_id
                       LEFT JOIN users r ON r.id = a.reviewer_id
                       WHERE a.slug = ?
                       LIMIT 1");
$stmt->execute([$slug]);
$article = $stmt->fetch();

$user = current_user();
$visible = $article && (
    $article['status'] === 'published' ||
    ($user && can_edit_article($article, $user))
);

if (!$visible) {
    http_response_code(404);
    render_header('Artigo não encontrado');
    echo '<main class="auth-shell"><section class="auth-card"><h1>Artigo não encontrado</h1><p>Este artigo não existe ou ainda não está disponível publicamente.</p></section></main>';
    render_footer();
    exit;
}

$headings = [];
if (preg_match_all('/^##\s+(.+)$/mu', $article['content'], $matches)) {
    foreach ($matches[1] as $heading) {
        $headings[] = ['id' => slugify($heading), 'title' => $heading];
    }
}

render_header($article['title']);
?>
<div class="page">
  <?php render_public_sidebar(); ?>

  <main class="article">
    <header class="article-header">
      <div class="article-kicker">Da Nexumpedia, a enciclopédia de conhecimento em conexão.</div>
      <h1><?= h($article['title']) ?></h1>
      <div class="article-tabs">
        <div class="tabs">
          <a class="tab active" href="artigo.php?slug=<?= urlencode($article['slug']) ?>">Artigo</a>
          <a class="tab" href="historico.php?slug=<?= urlencode($article['slug']) ?>">Histórico</a>
        </div>
        <div class="article-tools">
          <?php if ($user && can_edit_article($article, $user)): ?>
            <a href="editor.php?id=<?= (int)$article['id'] ?>">Editar</a>
          <?php endif; ?>
        </div>
      </div>
    </header>

    <?php if ($article['status'] !== 'published'): ?>
      <div class="notice"><strong><?= h(status_label($article['status'])) ?>.</strong> Esta versão só está visível porque você possui acesso editorial.</div>
    <?php endif; ?>

    <?php if ($article['summary']): ?><p class="lead"><?= h($article['summary']) ?></p><?php endif; ?>

    <?php if ($headings): ?>
      <nav class="inline-toc" aria-label="Índice">
        <strong>Índice</strong>
        <ol>
          <?php foreach ($headings as $heading): ?>
            <li><a href="#<?= h($heading['id']) ?>"><?= h($heading['title']) ?></a></li>
          <?php endforeach; ?>
        </ol>
      </nav>
    <?php endif; ?>

    <div class="article-content">
      <?= render_markup($article['content']) ?>
    </div>

    <footer class="footer">
      <?php if ($article['published_at']): ?>Publicado em <?= h(format_date($article['published_at'])) ?> · <?php endif; ?>
      última atualização em <?= h(format_date($article['updated_at'])) ?>.
      Autor inicial: <?= h($article['author_name']) ?>.
    </footer>
  </main>

  <aside class="toc-side" aria-label="Nesta página">
    <div class="nav-title">Nesta página</div>
    <?php foreach ($headings as $heading): ?><a href="#<?= h($heading['id']) ?>"><?= h($heading['title']) ?></a><?php endforeach; ?>
  </aside>
</div>
<?php render_footer(); ?>
