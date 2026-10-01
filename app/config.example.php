<?php
// Use tools/configure.py to generate config.php and the matching permanent QR.
// Store the database outside every publicly served website directory.
return [
    'data_dir' => '/home/your-user/holt-laury-data',
    'admin_key_hash' => 'REPLACE_WITH_SHA256_OF_YOUR_PRIVATE_ACCESS_CODE',
    'base_url' => 'https://example.org/experiment/',
    'cookie_path' => '/experiment/',
];
