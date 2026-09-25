<?php
declare(strict_types=1);

const NEXUM_ROOT = __DIR__ . '/..';
const NEXUM_DATA = NEXUM_ROOT . '/data';
const NEXUM_UPLOADS = NEXUM_ROOT . '/uploads';
const NEXUM_MAX_UPLOAD = 5 * 1024 * 1024;

if (!is_dir(NEXUM_DATA)) {
    mkdir(NEXUM_DATA, 0775, true);
}
if (!is_dir(NEXUM_UPLOADS)) {
    mkdir(NEXUM_UPLOADS, 0775, true);
}

$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
if (session_status() !== PHP_SESSION_ACTIVE) {
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $pdo = new PDO('sqlite:' . NEXUM_DATA . '/nexumpedia.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA journal_mode = WAL');
    migrate($pdo);

    return $pdo;
}

function migrate(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','collaborator')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','published','archived')),
    author_id INTEGER NOT NULL,
    reviewer_id INTEGER,
    published_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(author_id) REFERENCES users(id),
    FOREIGN KEY(reviewer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS article_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL,
    version_no INTEGER NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    editor_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY(editor_id) REFERENCES users(id),
    UNIQUE(article_id, version_no)
);

CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    alt_text TEXT NOT NULL DEFAULT '',
    uploader_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(uploader_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_author ON articles(author_id);
CREATE INDEX IF NOT EXISTS idx_versions_article ON article_versions(article_id, version_no DESC);
SQL);
}

function h(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function redirect(string $path): never
{
    header('Location: ' . $path);
    exit;
}

function current_user(): ?array
{
    static $loaded = false;
    static $user = null;

    if ($loaded) {
        return $user;
    }
    $loaded = true;

    $id = $_SESSION['user_id'] ?? null;
    if (!$id) {
        return null;
    }

    $stmt = db()->prepare('SELECT id, username, display_name, email, role, active, created_at FROM users WHERE id = ?');
    $stmt->execute([(int)$id]);
    $found = $stmt->fetch();

    if (!$found || !(int)$found['active']) {
        unset($_SESSION['user_id']);
        return null;
    }

    $user = $found;
    return $user;
}

function require_login(): array
{
    $user = current_user();
    if (!$user) {
        flash('error', 'Entre na sua conta para acessar essa área.');
        redirect('login.php');
    }
    return $user;
}

function require_admin(): array
{
    $user = require_login();
    if ($user['role'] !== 'admin') {
        http_response_code(403);
        exit('Acesso restrito a administradores.');
    }
    return $user;
}

function has_users(): bool
{
    return (int)db()->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0;
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . h(csrf_token()) . '">';
}

function verify_csrf(): void
{
    $sent = $_POST['csrf'] ?? '';
    if (!is_string($sent) || !hash_equals(csrf_token(), $sent)) {
        http_response_code(419);
        exit('A sessão expirou ou a solicitação é inválida. Volte e tente novamente.');
    }
}

function flash(string $type, string $message): void
{
    $_SESSION['flash'][] = ['type' => $type, 'message' => $message];
}

function flashes(): array
{
    $items = $_SESSION['flash'] ?? [];
    unset($_SESSION['flash']);
    return is_array($items) ? $items : [];
}

function slugify(string $text): string
{
    $text = trim(mb_strtolower($text, 'UTF-8'));
    if (function_exists('iconv')) {
        $converted = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text);
        if ($converted !== false) {
            $text = $converted;
        }
    }
    $text = preg_replace('/[^a-z0-9]+/i', '-', $text) ?? '';
    $text = trim($text, '-');
    return $text !== '' ? strtolower($text) : 'artigo';
}

function unique_slug(string $title, ?int $ignoreId = null): string
{
    $base = slugify($title);
    $slug = $base;
    $n = 2;

    while (true) {
        $sql = 'SELECT id FROM articles WHERE slug = ?';
        $params = [$slug];
        if ($ignoreId !== null) {
            $sql .= ' AND id <> ?';
            $params[] = $ignoreId;
        }
        $stmt = db()->prepare($sql);
        $stmt->execute($params);
        if (!$stmt->fetch()) {
            return $slug;
        }
        $slug = $base . '-' . $n++;
    }
}

function status_label(string $status): string
{
    return [
        'draft' => 'Rascunho',
        'review' => 'Em revisão',
        'published' => 'Publicado',
        'archived' => 'Arquivado',
    ][$status] ?? $status;
}

function can_edit_article(array $article, array $user): bool
{
    if ($user['role'] === 'admin') {
        return true;
    }

    return (int)$article['author_id'] === (int)$user['id']
        && in_array($article['status'], ['draft', 'review'], true);
}

function save_article_version(int $articleId, int $editorId): void
{
    $pdo = db();
    $stmt = $pdo->prepare('SELECT title, summary, content, status FROM articles WHERE id = ?');
    $stmt->execute([$articleId]);
    $article = $stmt->fetch();
    if (!$article) {
        return;
    }

    $v = $pdo->prepare('SELECT COALESCE(MAX(version_no), 0) + 1 FROM article_versions WHERE article_id = ?');
    $v->execute([$articleId]);
    $versionNo = (int)$v->fetchColumn();

    $insert = $pdo->prepare('INSERT INTO article_versions (article_id, version_no, title, summary, content, status, editor_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $insert->execute([
        $articleId,
        $versionNo,
        $article['title'],
        $article['summary'],
        $article['content'],
        $article['status'],
        $editorId,
    ]);
}

function inline_markup(string $text): string
{
    $safe = h($text);
    $safe = preg_replace('/\*\*(.+?)\*\*/u', '<strong>$1</strong>', $safe) ?? $safe;
    $safe = preg_replace('/(?<!\*)\*([^*]+)\*(?!\*)/u', '<em>$1</em>', $safe) ?? $safe;
    $safe = preg_replace_callback('/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/u', function (array $m): string {
        return '<a href="' . h(htmlspecialchars_decode($m[2], ENT_QUOTES)) . '" rel="noopener noreferrer">' . $m[1] . '</a>';
    }, $safe) ?? $safe;
    return $safe;
}

function render_markup(string $content): string
{
    $lines = preg_split('/\R/u', trim($content)) ?: [];
    $html = [];
    $inList = false;

    foreach ($lines as $line) {
        if (preg_match('/^!\[([^\]]*)\]\((\/uploads\/[a-f0-9]{24}\.(?:jpg|jpeg|png|webp|gif))\)$/i', trim($line), $m)) {
            if ($inList) { $html[] = '</ul>'; $inList = false; }
            $html[] = '<figure class="article-image"><img src="' . h($m[2]) . '" alt="' . h($m[1]) . '"><figcaption>' . h($m[1]) . '</figcaption></figure>';
            continue;
        }
        if (preg_match('/^###\s+(.+)$/u', $line, $m)) {
            if ($inList) { $html[] = '</ul>'; $inList = false; }
            $html[] = '<h3>' . inline_markup($m[1]) . '</h3>';
            continue;
        }
        if (preg_match('/^##\s+(.+)$/u', $line, $m)) {
            if ($inList) { $html[] = '</ul>'; $inList = false; }
            $id = slugify(strip_tags($m[1]));
            $html[] = '<h2 id="' . h($id) . '">' . inline_markup($m[1]) . '</h2>';
            continue;
        }
        if (preg_match('/^-\s+(.+)$/u', $line, $m)) {
            if (!$inList) { $html[] = '<ul>'; $inList = true; }
            $html[] = '<li>' . inline_markup($m[1]) . '</li>';
            continue;
        }
        if ($inList) { $html[] = '</ul>'; $inList = false; }
        if (trim($line) === '') {
            continue;
        }
        $html[] = '<p>' . inline_markup($line) . '</p>';
    }

    if ($inList) {
        $html[] = '</ul>';
    }

    return implode("\n", $html);
}

function format_date(?string $date): string
{
    if (!$date) {
        return '—';
    }
    $ts = strtotime($date);
    return $ts ? date('d/m/Y H:i', $ts) : $date;
}
