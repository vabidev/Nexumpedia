<?php
declare(strict_types=1);

require_once __DIR__ . '/app/bootstrap.php';

$slug = db()->query("SELECT slug FROM articles WHERE status = 'published' ORDER BY RANDOM() LIMIT 1")->fetchColumn();
if (!$slug) {
    redirect('index.php');
}
redirect('artigo.php?slug=' . urlencode((string)$slug));
