<?php
declare(strict_types=1);

require_once __DIR__ . '/app/view.php';

$admin = require_admin();
$pdo = db();
$errors = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    $action = (string)($_POST['action'] ?? 'create');

    if ($action === 'toggle') {
        $targetId = (int)($_POST['user_id'] ?? 0);
        if ($targetId === (int)$admin['id']) {
            $errors[] = 'Você não pode desativar sua própria conta.';
        } else {
            $stmt = $pdo->prepare('UPDATE users SET active = CASE active WHEN 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
            $stmt->execute([$targetId]);
            flash('success', 'Estado da conta atualizado.');
            redirect('usuarios.php');
        }
    } else {
        $username = trim((string)($_POST['username'] ?? ''));
        $displayName = trim((string)($_POST['display_name'] ?? ''));
        $email = trim((string)($_POST['email'] ?? ''));
        $password = (string)($_POST['password'] ?? '');
        $role = (string)($_POST['role'] ?? 'collaborator');

        if (!preg_match('/^[A-Za-z0-9_.-]{3,30}$/', $username)) {
            $errors[] = 'Usuário inválido.';
        }
        if (mb_strlen($displayName) < 2 || mb_strlen($displayName) > 80) {
            $errors[] = 'Nome de exibição inválido.';
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = 'E-mail inválido.';
        }
        if (strlen($password) < 10) {
            $errors[] = 'A senha precisa ter pelo menos 10 caracteres.';
        }
        if (!in_array($role, ['admin', 'collaborator'], true)) {
            $errors[] = 'Papel inválido.';
        }

        if (!$errors) {
            try {
                $stmt = $pdo->prepare('INSERT INTO users (username, display_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)');
                $stmt->execute([$username, $displayName, $email, password_hash($password, PASSWORD_DEFAULT), $role]);
                flash('success', 'Usuário criado com sucesso.');
                redirect('usuarios.php');
            } catch (PDOException $e) {
                $errors[] = 'Esse usuário ou e-mail já está cadastrado.';
            }
        }
    }
}

$users = $pdo->query('SELECT id, username, display_name, email, role, active, created_at FROM users ORDER BY role ASC, display_name ASC')->fetchAll();

render_header('Usuários', false);
?>
<main class="admin-shell">
  <div class="admin-header">
    <div><div class="meta">Administração</div><h1>Usuários</h1></div>
    <a class="secondary" href="painel.php">← Painel</a>
  </div>

  <?php if ($errors): ?><div class="form-errors"><?php foreach ($errors as $error): ?><div><?= h($error) ?></div><?php endforeach; ?></div><?php endif; ?>

  <div class="settings-grid">
    <section class="card">
      <div class="card-title">Adicionar colaborador</div>
      <div class="card-body">
        <form method="post" class="stack-form">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="create">
          <label>Usuário<input name="username" required value="<?= h($_POST['username'] ?? '') ?>"></label>
          <label>Nome de exibição<input name="display_name" required value="<?= h($_POST['display_name'] ?? '') ?>"></label>
          <label>E-mail<input type="email" name="email" required value="<?= h($_POST['email'] ?? '') ?>"></label>
          <label>Senha inicial<input type="password" name="password" minlength="10" required></label>
          <label>Papel
            <select name="role">
              <option value="collaborator">Colaborador</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
          <button class="primary">Criar conta</button>
        </form>
      </div>
    </section>

    <section class="card">
      <div class="card-title">Contas cadastradas</div>
      <div class="card-body no-pad">
        <div class="table-wrap borderless">
          <table>
            <thead><tr><th>Nome</th><th>Papel</th><th>Estado</th><th></th></tr></thead>
            <tbody>
            <?php foreach ($users as $account): ?>
              <tr>
                <td><strong><?= h($account['display_name']) ?></strong><br><span class="meta">@<?= h($account['username']) ?> · <?= h($account['email']) ?></span></td>
                <td><?= $account['role'] === 'admin' ? 'Administrador' : 'Colaborador' ?></td>
                <td><span class="badge <?= (int)$account['active'] ? 'good' : '' ?>"><?= (int)$account['active'] ? 'Ativo' : 'Desativado' ?></span></td>
                <td>
                  <?php if ((int)$account['id'] !== (int)$admin['id']): ?>
                  <form method="post" class="inline-form">
                    <?= csrf_field() ?>
                    <input type="hidden" name="action" value="toggle">
                    <input type="hidden" name="user_id" value="<?= (int)$account['id'] ?>">
                    <button class="link-button"><?= (int)$account['active'] ? 'Desativar' : 'Ativar' ?></button>
                  </form>
                  <?php endif; ?>
                </td>
              </tr>
            <?php endforeach; ?>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
</main>
<?php render_footer(); ?>
