#!/usr/bin/env python3
"""Build a private, ready-to-upload deployment. Never commit the output."""
import argparse
import getpass
import hashlib
import re
import secrets
import shutil
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]


def canonical_url(value):
    parts = urlsplit(value)
    if parts.scheme not in ('http', 'https') or not parts.hostname:
        raise ValueError('Use an absolute https:// URL (http is allowed for localhost only).')
    if parts.username is not None or parts.password is not None or parts.query or parts.fragment:
        raise ValueError('The URL must not contain credentials, a query, or a fragment.')
    host = parts.hostname.lower()
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', host) or '..' in host:
        raise ValueError('Use a DNS hostname, an IPv4 address, or localhost.')
    if parts.scheme == 'http' and host not in ('localhost', '127.0.0.1'):
        raise ValueError('A public deployment must use HTTPS.')
    port = parts.port  # Reject invalid ports.
    if port == 0:
        raise ValueError('Port must be between 1 and 65535.')
    default = 443 if parts.scheme == 'https' else 80
    authority = host + (f':{port}' if port is not None and port != default else '')
    path = parts.path or '/'
    if not re.fullmatch(r'/[A-Za-z0-9_/-]*', path) or '//' in path:
        raise ValueError('Use a URL path containing letters, numbers, hyphens, underscores, and slashes.')
    return urlunsplit((parts.scheme, authority, path.rstrip('/') + '/', '', ''))


def php_string(value):
    return "'" + value.replace('\\', '\\\\').replace("'", "\\'") + "'"


def redirect_rules(url):
    parts = urlsplit(url)
    authority = re.escape(parts.netloc)
    # A browser may send an explicit default port in Host.
    if parts.port is None:
        authority += '(?::443)?' if parts.scheme == 'https' else '(?::80)?'
    lines = ['<IfModule mod_rewrite.c>', '  RewriteEngine On']
    if parts.scheme == 'https':
        lines.append('  RewriteCond %{HTTPS} !=on [OR]')
    lines += [f'  RewriteCond %{{HTTP_HOST}} !^{authority}$ [NC]',
              f'  RewriteRule ^ {parts.scheme}://{parts.netloc}%{{REQUEST_URI}} [R=302,L]',
              '  RewriteRule ^admin/?$ admin.html [L]', '</IfModule>']
    return '\n'.join(lines) + '\n'


def build(url, data_dir, output, access_code):
    url = canonical_url(url)
    if not access_code or len(access_code) < 12:
        raise ValueError('Choose an instructor access code of at least 12 characters.')
    if not data_dir or any(ord(c) < 32 for c in data_dir):
        raise ValueError('Provide an absolute private data directory on the hosting server.')
    if not (PurePosixPath(data_dir).is_absolute() or Path(data_dir).is_absolute()):
        raise ValueError('The data directory must be an absolute server path.')
    if '..' in Path(data_dir).parts or '..' in PurePosixPath(data_dir).parts:
        raise ValueError('Use a data directory without parent-directory components.')
    if any(part.lower() in ('public_html', 'www', 'htdocs') for part in Path(data_dir).parts):
        raise ValueError('Keep data outside the public web directory.')
    output = Path(output).resolve()
    if Path(data_dir).resolve().is_relative_to(output):
        raise ValueError('Keep data outside the deployment directory.')
    if output.exists():
        raise ValueError(f'Output already exists: {output}. Choose a new output directory.')

    # Import before creating any files, so a missing dependency leaves no partial build.
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing
    from reportlab.graphics import renderSVG

    output.mkdir(parents=True)
    for source in (ROOT / 'app').iterdir():
        if source.is_file() and source.name not in ('config.php', 'config.example.php', 'join-qr.svg'):
            shutil.copy2(source, output / source.name)
    config = {
        'data_dir': data_dir,
        'admin_key_hash': hashlib.sha256(access_code.encode('utf-8')).hexdigest(),
        'base_url': url,
        'cookie_path': urlsplit(url).path,
    }
    php = '<?php\n// Private deployment settings. Do not publish this file.\nreturn [\n'
    php += ''.join(f'    {php_string(k)} => {php_string(v)},\n' for k, v in config.items())
    (output / 'config.php').write_text(php + '];\n', encoding='utf-8')
    htaccess = (output / '.htaccess').read_text(encoding='utf-8')
    (output / '.htaccess').write_text(redirect_rules(url) + htaccess, encoding='utf-8')

    qr = QrCodeWidget(url, barLevel='M')
    left, bottom, right, top = qr.getBounds()
    width, height = right - left, top - bottom
    drawing = Drawing(320, 320, transform=[320 / width, 0, 0, 320 / height, 0, 0])
    drawing.add(qr)
    renderSVG.drawToFile(drawing, str(output / 'join-qr.svg'))
    return url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True, help='Permanent student URL, e.g. https://example.org/experiment/')
    parser.add_argument('--data-dir', required=True, help='Absolute PRIVATE path on the hosting server')
    parser.add_argument('--output', type=Path, default=ROOT / 'build' / 'experiment')
    args = parser.parse_args()
    try:
        canonical_url(args.url)
        code = getpass.getpass('Instructor access code (12+ characters; Enter generates one): ')
        generated = not code
        if generated:
            code = secrets.token_urlsafe(18)
        elif getpass.getpass('Repeat access code: ') != code:
            raise ValueError('The access codes do not match.')
        url = build(args.url, args.data_dir, args.output, code)
    except (ValueError, OSError, ImportError) as error:
        parser.exit(1, f'Error: {error}\n')
    print(f'Upload the contents of {args.output.resolve()} to the directory served at {url}')
    print(f'Instructor: {url}admin.html')
    if generated:
        print(f'Private instructor access code: {code}')
    print('Keep config.php and this build private. The access code persists across session resets.')


if __name__ == '__main__':
    main()
