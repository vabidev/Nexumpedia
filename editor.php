<?php
declare(strict_types=1);

require_once __DIR__ . '/app/view.php';

$user = require_login();
$pdo = db();
$id = (int)($_GET['id'] ?? $_POST['id'] ?? 0);
$article = null;

if ($id > 0) {
    $stmt = $pdo->prepare('SELECT * FROM articles WHERE id = ?');
    $stmt->execute([$id]);
    $article = $stmt->fetch();
    if (!$article) {
        http_response_code(404);
        exit('Artigo não encontrado.');
    }
    if (!can_edit_article($article, $user)) {
        http_response_code(403);
        exit('Você não possui permissão para editar este artigo.');
    }
}

$errors = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();

    $title = trim((string)($_POST['title'] ?? ''));
    $summary = trim((string)($_POST['summary'] ?? ''));
    $content = trim((string)($_POST['content'] ?? ''));
    $action = (string)($_POST['action'] ?? 'save');

    if (mb_strlen($title) < 2 || mb_strlen($title) > 180) {
        $errors[] = 'O título deve ter entre 2 e 180 caracteres.';
    }
    if (mb_strlen($summary) > 500) {
        $errors[] = 'O resumo pode ter no máximo 500 caracteres.';
    }
    if (mb_strlen($content) < 10) {
        $errors[] = 'O artigo precisa ter algum conteúdo antes de ser salvo.';
    }

    $allowedActions = $user['role'] === 'admin'
        ? ['save', 'review', 'publish', 'archive']
        : ['save', 'review'];

    if (!in_array($action, $allowedActions, true)) {
        $errors[] = 'Ação editorial inválida para sua conta.';
    }

    if (!$errors) {
        if ($action === 'review') {
            $status = 'review';
        } elseif ($action === 'publish') {
            $status = 'published';
        } elseif ($action === 'archive') {
            $status = 'archived';
        } else {
            $status = $article ? $article['status'] : 'draft';
            if ($user['role'] !== 'admin') {
                $status = 'draft';
            }
        }

        $pdo->beginTransaction();
        try {
            if ($article) {
                $sql = 'UPDATE articles
                        SET title = ?, summary = ?, content = ?, status = ?, reviewer_id = ?, published_at = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?';
                $reviewerId = in_array($status, ['published', 'archived'], true) ? (int)$user['id'] : $article['reviewer_id'];
                $publishedAt = $status === 'published'
                    ? ($article['published_at'] ?: date('Y-m-d H:i:s'))
                    : $article['published_at'];

                $stmt = $pdo->prepare($sql);
                $stmt->execute([$title, $summary, $content, $status, $reviewerId, $publishedAt, (int)$article['id']]);
                $articleId = (int)$article['id'];
            } else {
                $slug = unique_slug($title);
                $reviewerId = $status === 'published' ? (int)$user['id'] : null;
                $publishedAt = $status === 'published' ? date('Y-m-d H:i:s') : null;
                $stmt = $pdo->prepare('INSERT INTO articles (slug, title, summary, content, status, author_id, reviewer_id, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
                $stmt->execute([$slug, $title, $summary, $content, $status, (int)$user['id'], $reviewerId, $publishedAt]);
                $articleId = (int)$pdo->lastInsertId();
            }

            save_article_version($articleId, (int)$user['id']);
            $pdo->commit();

            $label = status_label($status);
            flash('success', 'Artigo salvo. Estado atual: ' . $label . '.');
            redirect('editor.php?id=' . $articleId);
        } catch (Throwable $e) {
            $pdo->rollBack();
            $errors[] = 'Não foi possível salvar o artigo.';
        }
    }

    $article = array_merge($article ?: [], [
        'id' => $id,
        'title' => $title,
        'summary' => $summary,
        'content' => $content,
        'status' => $article['status'] ?? 'draft',
    ]);
}

render_header($article ? 'Editar artigo' : 'Novo artigo', false);
?>
<main class="editor-shell">
  <div class="editor-topline">
    <div>
      <div class="meta">Área editorial</div>
      <h1><?= $article ? 'Editar artigo' : 'Novo artigo' ?></h1>
    </div>
    <div class="button-row">
      <a class="secondary" href="painel.php">← Painel</a>
      <?php if ($article && !empty($article['slug'])): ?><a class="secondary" href="artigo.php?slug=<?= urlencode($article['slug']) ?>">Visualizar</a><?php endif; ?>
    </div>
  </div>

  <?php if ($article): ?>
    <div class="notice">Estado atual: <strong><?= h(status_label($article['status'])) ?></strong>.
      <?php if ($user['role'] !== 'admin'): ?> A publicação final depende de um administrador.<?php endif; ?>
    </div>
  <?php endif; ?>

  <?php if ($errors): ?>
    <div class="form-errors"><?php foreach ($errors as $error): ?><div><?= h($error) ?></div><?php endforeach; ?></div>
  <?php endif; ?>

  <form method="post" class="editor-form">
    <?= csrf_field() ?>
    <input type="hidden" name="id" value="<?= (int)($article['id'] ?? 0) ?>">

    <label>Título
      <input name="title" required maxlength="180" value="<?= h($article['title'] ?? '') ?>">
    </label>

    <label>Resumo
      <textarea name="summary" rows="3" maxlength="500" placeholder="Uma descrição curta do artigo."><?= h($article['summary'] ?? '') ?></textarea>
    </label>

    <div class="editor-grid">
      <label>Conteúdo
        <textarea class="article-editor" name="content" rows="26" required placeholder="Escreva o artigo aqui..."><?= h($article['content'] ?? '') ?></textarea>
      </label>

      <aside class="editor-help">
        <h3>Formatação</h3>
        <code>## Seção</code>
        <code>### Subseção</code>
        <code>**negrito**</code>
        <code>*itálico*</code>
        <code>- item de lista</code>
        <code>[fonte](https://...)</code>
        <p>Imagens enviadas na <a href="midia.php" target="_blank">biblioteca de mídia</a> fornecem um código pronto para colar no artigo.</p>
      </aside>
    </div>

    <div class="editor-actions">
      <button class="secondary" type="submit" name="action" value="save">Salvar rascunho</button>
      <button class="secondary" type="submit" name="action" value="review">Enviar para revisão</button>
      <?php if ($user['role'] === 'admin'): ?>
        <button class="primary" type="submit" name="action" value="publish">Publicar</button>
        <?php if ($article): ?><button class="danger" type="submit" name="action" value="archive">Arquivar</button><?php endif; ?>
      <?php endif; ?>
    </div>
  </form>
</main>
<?php render_footer(); ?>
