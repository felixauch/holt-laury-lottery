import hashlib
import re
import sys
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from configure import build, canonical_url, redirect_rules


class SetupTests(unittest.TestCase):
    def test_urls_and_ports(self):
        self.assertEqual(canonical_url('https://EXAMPLE.org:443/experiment'), 'https://example.org/experiment/')
        self.assertEqual(canonical_url('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080/')
        for bad in ['http://example.org/', 'https://user:secret@example.org/',
                    'https://example.org/?x=1', 'https://example.org/#x',
                    'https://example.org/a/../b/', 'https://example.org/a%0Ab/',
                    'https://example.org:0/', 'https://example.org:99999/']:
            with self.subTest(url=bad), self.assertRaises(ValueError):
                canonical_url(bad)

    def test_canonical_hostname_redirect(self):
        rules = redirect_rules('https://example.org/experiment/')
        host_pattern = next(line.split(' !', 1)[1].split(' [', 1)[0]
                            for line in rules.splitlines() if 'HTTP_HOST' in line)
        self.assertIsNotNone(re.fullmatch(host_pattern, 'example.org'))
        self.assertIsNotNone(re.fullmatch(host_pattern, 'example.org:443'))
        self.assertIsNone(re.fullmatch(host_pattern, 'www.example.org'))
        self.assertIsNone(re.fullmatch(host_pattern, 'example.org.attacker.test'))
        self.assertIn('https://example.org%{REQUEST_URI}', rules)
        self.assertIn('RewriteCond %{HTTPS} !=on [OR]', rules)
        self.assertNotIn('%{HTTPS}', redirect_rules('http://127.0.0.1:8080/'))

    def test_private_build_and_qr(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'public'
            code = 'synthetic-test-code-only'
            url = build('https://example.org/experiment', str(root / 'private'), output, code)
            config = (output / 'config.php').read_text(encoding='utf-8')
            self.assertIn(hashlib.sha256(code.encode()).hexdigest(), config)
            self.assertNotIn(code, config)
            self.assertIn("'cookie_path' => '/experiment/'", config)
            self.assertIn(url, config)
            self.assertFalse((output / 'config.example.php').exists())
            self.assertFalse((output / 'experiment.sqlite').exists())
            svg = ElementTree.parse(output / 'join-qr.svg').getroot()
            self.assertEqual(svg.tag, '{http://www.w3.org/2000/svg}svg')
            self.assertGreater(len(list(svg.iter())), 100)
            self.assertIn('https://example.org%{REQUEST_URI}', (output / '.htaccess').read_text())
            with self.assertRaises(ValueError):
                build(url, str(root / 'private'), output, code)

    def test_reject_public_or_relative_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'public'
            for data in ['relative/data', str(output / 'data'), '/home/user/public_html/data']:
                with self.subTest(data=data), self.assertRaises(ValueError):
                    build('https://example.org/', data, output, 'synthetic-test-code-only')


if __name__ == '__main__':
    unittest.main()
