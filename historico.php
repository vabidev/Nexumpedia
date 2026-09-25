<?php
declare(strict_types=1);

require_once __DIR__ . '/app/view.php';

$slug = trim((string)($_GET['slug'] ?? ''));
$stmt = db()->prepare('SELECT * FROM articles WHERE slug = ? LIMIT 1');
$stmt->execute([$slug]);
$article = $stmt->fetch();

if (!$article) {
    http_response_code(404);
    exit('Artigo não encontrado.');
}

$user = current_user();
$editorAccess = $user && can_edit_article($article, $user);
if ($article['status'] !== 'published' && !$editorAccess) {
    http_response_code(404);
    exit('Artigo não encontrado.');
}

$sql = "SELECT v.*, u.display_name AS editor_name
        FROM article_versions v
        JOIN users u ON u.id = v.editor_id
        WHERE v.article_id = ?";
$params = [(int)$article['id']];
if (!$editorAccess) {
    $sql .= " AND v.status = 'published'";
}
$sql .= ' ORDER BY v.version_no DESC';

$stmt = db()->prepare($sql);
$stmt->execute($params);
$versions = $stmt->fetchAll();

render_header('Histórico de ' . $article['title']);
?>
<div class="page">
  <?php render_public_sidebar(); ?>
  <main class="article">
    <header class="article-header">
      <div class="article-kicker">Histórico de versões</div>
      <h1><?= h($article['title']) ?></h1>
      <div class="article-tabs">
        <div class="tabs">
          <a class="tab" href="artigo.php?slug=<?= urlencode($article['slug']) ?>">Artigo</a>
          <a class="tab active" href="#">Histórico</a>
        </div>
      </div>
    </header>

    <p>Cada salvamento cria uma versão independente. Rascunhos e versões em revisão ficam visíveis apenas para usuários com acesso editorial.</p>

    <div class="table-wrap">
      <table>
        <thead><tr><th>Versão</th><th>Estado</th><th>Editor</th><th>Data</th><th>Resumo</th></tr></thead>
        <tbody>
        <?php if (!$versions): ?>
          <tr><td colspan="5">Nenhuma versão disponível.</td></tr>
        <?php else: ?>
          <?php foreach ($versions as $version): ?>
            <tr>
              <td>#<?= (int)$version['version_no'] ?></td>
              <td><span class="badge <?= $version['status'] === 'published' ? 'good' : '' ?>"><?= h(status_label($version['status'])) ?></span></td>
              <td><?= h($version['editor_name']) ?></td>
              <td><?= h(format_date($version['created_at'])) ?></td>
              <td><?= h(mb_strimwidth($version['summary'], 0, 100, '…')) ?></td>
            </tr>
          <?php endforeach; ?>
        <?php endif; ?>
        </tbody>
      </table>
    </div>
  </main>
  <aside class="toc-side"><div class="nav-title">Ferramentas</div><a href="artigo.php?slug=<?= urlencode($article['slug']) ?>">Voltar ao artigo</a></aside>
</div>
<?php render_footer(); ?>
