<?php
declare(strict_types=1);

require_once __DIR__ . '/app/view.php';

$user = require_login();
$pdo = db();

$where = $user['role'] === 'admin' ? '1=1' : 'a.author_id = :uid';
$params = $user['role'] === 'admin' ? [] : [':uid' => (int)$user['id']];

$stats = ['published' => 0, 'review' => 0, 'draft' => 0, 'archived' => 0];
$stmt = $pdo->prepare("SELECT a.status, COUNT(*) AS total FROM articles a WHERE $where GROUP BY a.status");
$stmt->execute($params);
foreach ($stmt->fetchAll() as $row) {
    $stats[$row['status']] = (int)$row['total'];
}

$stmt = $pdo->prepare("SELECT a.*, u.display_name AS author_name
                       FROM articles a
                       JOIN users u ON u.id = a.author_id
                       WHERE $where
                       ORDER BY a.updated_at DESC
                       LIMIT 40");
$stmt->execute($params);
$articles = $stmt->fetchAll();

render_header('Painel editorial', false);
?>
<main class="admin-shell">
  <div class="admin-header">
    <div>
      <div class="meta"><?= $user['role'] === 'admin' ? 'Administrador' : 'Colaborador' ?> · <?= h($user['display_name']) ?></div>
      <h1>Painel editorial</h1>
    </div>
    <div class="button-row">
      <a class="primary" href="editor.php">+ Novo artigo</a>
      <a class="secondary" href="midia.php">Mídia</a>
      <?php if ($user['role'] === 'admin'): ?><a class="secondary" href="usuarios.php">Usuários</a><?php endif; ?>
    </div>
  </div>

  <div class="dashboard">
    <div class="stat"><span class="meta">Publicados</span><strong><?= $stats['published'] ?></strong><span class="badge good">públicos</span></div>
    <div class="stat"><span class="meta">Em revisão</span><strong><?= $stats['review'] ?></strong><span class="badge">aguardando</span></div>
    <div class="stat"><span class="meta">Rascunhos</span><strong><?= $stats['draft'] ?></strong><span class="badge">internos</span></div>
    <div class="stat"><span class="meta">Arquivados</span><strong><?= $stats['archived'] ?></strong><span class="badge">ocultos</span></div>
  </div>

  <?php if ($user['role'] === 'collaborator'): ?>
    <div class="notice">Colaboradores podem criar rascunhos e enviá-los para revisão. A publicação final é feita por um administrador.</div>
  <?php endif; ?>

  <h2 class="section-title">Artigos</h2>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Artigo</th><th>Autor</th><th>Estado</th><th>Atualização</th><th>Ações</th></tr></thead>
      <tbody>
      <?php if (!$articles): ?>
        <tr><td colspan="5">Nenhum artigo ainda.</td></tr>
      <?php else: ?>
        <?php foreach ($articles as $article): ?>
          <tr>
            <td><strong><?= h($article['title']) ?></strong><br><span class="meta">/<?= h($article['slug']) ?></span></td>
            <td><?= h($article['author_name']) ?></td>
            <td><span class="badge <?= $article['status'] === 'published' ? 'good' : '' ?>"><?= h(status_label($article['status'])) ?></span></td>
            <td><?= h(format_date($article['updated_at'])) ?></td>
            <td class="table-actions">
              <a href="artigo.php?slug=<?= urlencode($article['slug']) ?>">Ver</a>
              <?php if (can_edit_article($article, $user)): ?> · <a href="editor.php?id=<?= (int)$article['id'] ?>">Editar</a><?php endif; ?>
              · <a href="historico.php?slug=<?= urlencode($article['slug']) ?>">Histórico</a>
            </td>
          </tr>
        <?php endforeach; ?>
      <?php endif; ?>
      </tbody>
    </table>
  </div>
</main>
<?php render_footer(); ?>
