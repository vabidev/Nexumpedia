<?php
declare(strict_types=1);

require_once __DIR__ . '/app/view.php';

if (has_users()) {
    redirect('login.php');
}

$errors = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();

    $username = trim((string)($_POST['username'] ?? ''));
    $displayName = trim((string)($_POST['display_name'] ?? ''));
    $email = trim((string)($_POST['email'] ?? ''));
    $password = (string)($_POST['password'] ?? '');
    $confirm = (string)($_POST['password_confirm'] ?? '');

    if (!preg_match('/^[A-Za-z0-9_.-]{3,30}$/', $username)) {
        $errors[] = 'O usuário deve ter entre 3 e 30 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.';
    }
    if (mb_strlen($displayName) < 2 || mb_strlen($displayName) > 80) {
        $errors[] = 'Informe um nome de exibição válido.';
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'Informe um e-mail válido.';
    }
    if (strlen($password) < 10) {
        $errors[] = 'Use uma senha com pelo menos 10 caracteres.';
    }
    if ($password !== $confirm) {
        $errors[] = 'As senhas não coincidem.';
    }

    if (!$errors) {
        $pdo = db();
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('INSERT INTO users (username, display_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)');
            $stmt->execute([$username, $displayName, $email, password_hash($password, PASSWORD_DEFAULT), 'admin']);
            $adminId = (int)$pdo->lastInsertId();

            $content = "A **Nexumpedia** é uma enciclopédia digital com conteúdo produzido e revisado por colaboradores autorizados.\n\n## Proposta\nA plataforma combina uma experiência de leitura familiar com autoria identificada, revisão editorial e histórico de versões.\n\n## Modelo editorial\n- Rascunhos são preparados por colaboradores.\n- Artigos podem ser enviados para revisão.\n- Administradores aprovam e publicam versões.\n- Cada salvamento gera uma entrada no histórico.\n\n## Identidade\nA Nexumpedia possui nome, marca e identidade visual próprios, preservando uma interface clássica de enciclopédia.";
            $article = $pdo->prepare("INSERT INTO articles (slug, title, summary, content, status, author_id, reviewer_id, published_at) VALUES (?, ?, ?, ?, 'published', ?, ?, CURRENT_TIMESTAMP)");
            $article->execute([
                'nexumpedia',
                'Nexumpedia',
                'Enciclopédia digital de conteúdo editorial revisado.',
                $content,
                $adminId,
                $adminId,
            ]);
            $articleId = (int)$pdo->lastInsertId();
            save_article_version($articleId, $adminId);

            $pdo->commit();

            session_regenerate_id(true);
            $_SESSION['user_id'] = $adminId;
            flash('success', 'Nexumpedia instalada. Sua conta de administrador foi criada.');
            redirect('painel.php');
        } catch (Throwable $e) {
            $pdo->rollBack();
            $errors[] = 'Não foi possível concluir a instalação. Verifique se o usuário ou e-mail já foi utilizado.';
        }
    }
}

render_header('Instalação', false);
?>
<main class="auth-shell">
  <section class="auth-card">
    <img class="auth-logo" src="assets/img/nexumpedia-mark.svg" alt="">
    <h1>Instalar a Nexumpedia</h1>
    <p class="muted">Crie a primeira conta. Ela será a administradora do projeto e poderá adicionar os demais colaboradores.</p>

    <?php if ($errors): ?>
      <div class="form-errors">
        <?php foreach ($errors as $error): ?><div><?= h($error) ?></div><?php endforeach; ?>
      </div>
    <?php endif; ?>

    <form method="post" class="stack-form">
      <?= csrf_field() ?>
      <label>Usuário
        <input name="username" required autocomplete="username" value="<?= h($_POST['username'] ?? '') ?>">
      </label>
      <label>Nome de exibição
        <input name="display_name" required value="<?= h($_POST['display_name'] ?? '') ?>">
      </label>
      <label>E-mail
        <input type="email" name="email" required autocomplete="email" value="<?= h($_POST['email'] ?? '') ?>">
      </label>
      <label>Senha
        <input type="password" name="password" required autocomplete="new-password" minlength="10">
      </label>
      <label>Confirmar senha
        <input type="password" name="password_confirm" required autocomplete="new-password" minlength="10">
      </label>
      <button class="primary" type="submit">Criar administrador e instalar</button>
    </form>
  </section>
</main>
<?php render_footer(); ?>
