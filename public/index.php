<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/app/bootstrap.php';

function respond_json(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function respond_text(int $status, string $body): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $body;
    exit;
}

function request_path(): string
{
    $uri = $_SERVER['REQUEST_URI'] ?? '/';
    $path = parse_url($uri, PHP_URL_PATH);
    return is_string($path) ? rtrim($path, '/') ?: '/' : '/';
}

try {
    $config = load_config();
} catch (Throwable $error) {
    respond_json(500, ['error' => 'Configuration error', 'message' => $error->getMessage()]);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = request_path();

if ($path === '/health') {
    respond_json(200, ['ok' => true, 'accounts' => count($config['accounts'])]);
}

if ($path === '/webhook' && $method === 'GET') {
    $mode = $_GET['hub_mode'] ?? $_GET['hub.mode'] ?? null;
    $verifyToken = $_GET['hub_verify_token'] ?? $_GET['hub.verify_token'] ?? null;
    $challenge = $_GET['hub_challenge'] ?? $_GET['hub.challenge'] ?? null;

    if ($mode === 'subscribe' && $verifyToken === $config['metaVerifyToken'] && is_string($challenge)) {
        respond_text(200, $challenge);
    }

    respond_text(403, 'Forbidden');
}

if ($path === '/webhook' && $method === 'POST') {
    $rawBody = file_get_contents('php://input');
    if ($rawBody === false || $rawBody === '') {
        respond_json(400, ['error' => 'Expected application/json request body']);
    }

    if ($config['verifyMetaSignatures']) {
        $signature = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';
        $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $config['metaAppSecret']);
        if (!is_string($signature) || !hash_equals($expected, $signature)) {
            respond_json(403, ['error' => 'Invalid Meta webhook signature']);
        }
    }

    $payload = json_decode($rawBody, true);
    if (!is_array($payload)) {
        respond_json(400, ['error' => 'Invalid JSON payload']);
    }

    $commentEvents = extract_comment_events($payload);
    $messageEvents = extract_message_events($payload);

    foreach ($commentEvents as $event) {
        $account = resolve_account_for_comment($config, $event);
        if ($account === null) {
            app_log_event($config, [
                'igUserId' => $event['igUserIdFromWebhook'] ?? null,
                'mediaId' => $event['mediaId'] ?? null,
                'commentId' => $event['commentId'],
                'status' => 'ignored',
                'reason' => 'No configured Instagram account matched webhook entry ID',
            ]);
            continue;
        }

        $moderated = process_moderation($config, $account, $event);
        if ($moderated) {
            continue;
        }

        process_private_reply($config, $account, $event);
        process_public_reply($config, $account, $event);
    }

    foreach ($messageEvents as $event) {
        $account = resolve_account_for_message($config, $event);
        if ($account === null) {
            app_log_event($config, [
                'igUserId' => $event['igUserIdFromWebhook'] ?? $event['recipientId'] ?? null,
                'messageId' => $event['messageId'],
                'senderId' => $event['senderId'],
                'status' => 'ignored',
                'reason' => 'No configured Instagram account matched webhook message recipient',
            ]);
            continue;
        }

        process_dm_auto_response($config, $account, $event);
    }

    respond_json(200, ['received' => true, 'comments' => count($commentEvents), 'messages' => count($messageEvents)]);
}

respond_json(404, ['error' => 'Not found']);

