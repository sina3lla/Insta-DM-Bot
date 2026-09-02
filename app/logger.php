<?php
declare(strict_types=1);

function app_log_event(array $config, array $event): void
{
    $event = ['timestamp' => gmdate('c')] + $event;
    error_log(json_encode($event, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    store_append_log($config['eventLogPath'], $event);
}

