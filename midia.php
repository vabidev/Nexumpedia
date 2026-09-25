<?php
declare(strict_types=1);

require_once __DIR__ . '/app/view.php';

$user = require_login();
$pdo = db();
$errors = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();

    $file = $_FILES['image'] ?? null;
    $alt = trim((string)($_POST['alt_text'] ?? ''));

    if (!$file || !is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $errors[] = 'Selecione uma imagem válida.';
    } elseif ((int)$file['size'] > NEXUM_MAX_UPLOAD) {
        $errors[] = 'A imagem pode ter no máximo 5 MB.';
    } else {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($file['tmp_name']);
        $allowed = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
        ];

        if (!isset($allowed[$mime])) {
            $errors[] = 'Formato não permitido. Use JPG, PNG, WebP ou GIF.';
        } elseif (!is_uploaded_file($file['tmp_name'])) {
            $errors[] = 'Upload inválido.';
        } else {
            $filename = bin2hex(random_bytes(12)) . '.' . $allowed[$mime];
            $target = NEXUM_UPLOADS . '/' . $filename;

            if (!move_uploaded_file($file['tmp_name'], $target)) {
                $errors[] = 'Não foi possível salvar a imagem no servidor.';
            } else {
                $stmt = $pdo->prepare('INSERT INTO media (filename, original_name, mime, size, alt_text, uploader_id) VALUES (?, ?, ?, ?, ?, ?)');
                $stmt->execute([
                    $filename,
                    basename((string)$file['name']),
                    $mime,
                    (int)$file['size'],
                    $alt,
                    (int)$user['id'],
                ]);
                flash('success', 'Imagem adicionada à biblioteca.');
                redirect('midia.php');
            }
        }
    }
}

$media = $pdo->query('SELECT m.*, u.display_name AS uploader_name FROM media m JOIN users u ON u.id = m.uploader_id ORDER BY m.created_at DESC LIMIT 100')->fetchAll();

render_header('Biblioteca de mídia', false);
?>
<main class="admin-shell">
  <div class="admin-header">
    <div><div class="meta">Área editorial</div><h1>Biblioteca de mídia</h1></div>
    <a class="secondary" href="painel.php">← Painel</a>
  </div>

  <?php if ($errors): ?><div class="form-errors"><?php foreach ($errors as $error): ?><div><?= h($error) ?></div><?php endforeach; ?></div><?php endif; ?>

  <section class="card upload-card">
    <div class="card-title">Enviar imagem</div>
    <div class="card-body">
      <form method="post" enctype="multipart/form-data" class="upload-form">
        <?= csrf_field() ?>
        <label>Imagem
          <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" required>
        </label>
        <label>Texto alternativo / legenda
          <input name="alt_text" maxlength="180" placeholder="Descreva o que aparece na imagem">
        </label>
        <button class="primary">Enviar</button>
      </form>
      <p class="meta">Máximo de 5 MB. Formatos aceitos: JPG, PNG, WebP e GIF.</p>
    </div>
  </section>

  <div class="media-grid">
    <?php if (!$media): ?><p>Nenhuma imagem enviada ainda.</p><?php endif; ?>
    <?php foreach ($media as $item): ?>
      <?php $path = '/uploads/' . $item['filename']; $markup = '![' . ($item['alt_text'] ?: 'Imagem') . '](' . $path . ')'; ?>
      <article class="media-card">
        <img src="<?= h($path) ?>" alt="<?= h($item['alt_text']) ?>">
        <div class="media-card-body">
          <strong><?= h($item['original_name']) ?></strong>
          <div class="meta"><?= h($item['uploader_name']) ?> · <?= number_format(((int)$item['size']) / 1024, 0, ',', '.') ?> KB</div>
          <label>Código para o artigo
            <input readonly value="<?= h($markup) ?>" onclick="this.select()">
          </label>
        </div>
      </article>
    <?php endforeach; ?>
  </div>
</main>
<?php render_footer(); ?>
