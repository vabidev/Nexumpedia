<?php
declare(strict_types=1);

require_once __DIR__ . '/app/view.php';

if (!has_users()) {
    redirect('install.php');
}
if (current_user()) {
    redirect('painel.php');
}

$error = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();

    $now = time();
    $attempts = $_SESSION['login_attempts'] ?? [];
    $attempts = array_values(array_filter(is_array($attempts) ? $attempts : [], fn($t) => is_int($t) && $t > $now - 900));

    if (count($attempts) >= 8) {
        $error = 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.';
    } else {
        $identity = trim((string)($_POST['identity'] ?? ''));
        $password = (string)($_POST['password'] ?? '');

        $stmt = db()->prepare('SELECT * FROM users WHERE (username = ? OR email = ?) AND active = 1 LIMIT 1');
        $stmt->execute([$identity, $identity]);
        $user = $stmt->fetch();

        if ($user && password_verify($password, $user['password_hash'])) {
            session_regenerate_id(true);
            $_SESSION['user_id'] = (int)$user['id'];
            unset($_SESSION['login_attempts']);
            flash('success', 'Bem-vindo de volta, ' . $user['display_name'] . '.');
            redirect('painel.php');
        }

        $attempts[] = $now;
        $_SESSION['login_attempts'] = $attempts;
        $error = 'Usuário/e-mail ou senha incorretos.';
    }
}

render_header('Entrar', false);
?>
<main class="auth-shell">
  <section class="auth-card">
    <img class="auth-logo" src="assets/img/nexumpedia-mark.svg" alt="">
    <h1>Entrar</h1>
    <p class="muted">A área editorial é reservada a administradores e colaboradores autorizados.</p>
    <?php if ($error): ?><div class="form-errors"><?= h($error) ?></div><?php endif; ?>
    <form method="post" class="stack-form">
      <?= csrf_field() ?>
      <label>Usuário ou e-mail
        <input name="identity" required autofocus autocomplete="username" value="<?= h($_POST['identity'] ?? '') ?>">
      </label>
      <label>Senha
        <input type="password" name="password" required autocomplete="current-password">
      </label>
      <button class="primary" type="submit">Entrar</button>
    </form>
  </section>
</main>
<?php render_footer(); ?>
