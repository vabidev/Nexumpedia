<?php
declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if (preg_match('#^/(?:app|data)(?:/|$)#', $path)) {
    http_response_code(404);
    exit('Not found');
}

if (preg_match('#^/uploads/.*\.(?:php|phtml|phar|cgi|pl|py|sh)$#i', $path)) {
    http_response_code(404);
    exit('Not found');
}

$file = __DIR__ . $path;
if ($path !== '/' && is_file($file)) {
    return false;
}

if ($path === '/') {
    require __DIR__ . '/index.php';
    return true;
}

return false;
