"""Real PHP/SQLite integration check, confined to a disposable local build."""
import http.cookiejar
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from configure import build


class Client:
    def __init__(self, base):
        self.base = base
        self.csrf = ''
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, action, data=None, *, expected=200, origin=None, csrf=None):
        headers = {}
        if data is not None:
            headers = {'Content-Type': 'application/json',
                       'Origin': origin or self.base.rstrip('/'),
                       'X-CSRF-Token': self.csrf if csrf is None else csrf}
        req = urllib.request.Request(self.base + 'api.php?action=' + action,
                                     data=None if data is None else json.dumps(data).encode(),
                                     headers=headers)
        try:
            response = self.opener.open(req, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status, content = response.status, response.read().decode()
        assert status == expected, (action, status, expected, content)
        result = json.loads(content)
        if 'csrf' in result:
            self.csrf = result['csrf']
        return result


def main():
    php = shutil.which('php')
    if not php:
        raise SystemExit('PHP with PDO_SQLite must be installed and on PATH to run this check.')
    with tempfile.TemporaryDirectory(prefix='holt-laury-test-') as directory:
        root = Path(directory)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        base = f'http://127.0.0.1:{port}/'
        code = 'synthetic-integration-code'
        public = root / 'public'
        build(base, str(root / 'private'), public, code)
        log = (root / 'server.log').open('w+', encoding='utf-8')
        server = subprocess.Popen([php, '-S', f'127.0.0.1:{port}', '-t', str(public)],
                                  stdout=log, stderr=log)
        try:
            admin = Client(base)
            for attempt in range(50):
                try:
                    admin.request('state')
                    break
                except urllib.error.URLError:
                    if server.poll() is not None:
                        raise RuntimeError('PHP server exited before becoming ready.')
                    time.sleep(0.1)
            else:
                raise RuntimeError('PHP server did not start.')
            admin.request('login', {'key': code}, origin='https://other.example', expected=403)
            admin.request('login', {'key': code}, csrf='invalid', expected=403)
            admin.request('login', {'key': 'wrong'}, expected=401)
            admin.request('login', {'key': code})
            session = admin.request('create', {'title': 'Synthetic integration test', 'mode': 'practice'})['id']
            people = []
            choices = [list('AAAABBBBBB'), list('BBBBBBBBBB'), list('AAAAAAAAAA')]
            for i in range(4):
                person = Client(base)
                person.request('state')
                person.request('sessions', expected=401)
                joined = person.request('join', {'name': f'Synthetic {i}', 'protocol': 2})['participant']
                assert joined['class_id'] == session
                assert joined['payoffs'] == {'A': [400, 320], 'B': [770, 20]}
                if i < 3:
                    person.request('submit', {'choices': ['A'], 'protocol': 2}, expected=400)
                    saved = person.request('submit', {'choices': choices[i], 'protocol': 2})['participant']
                    assert saved['choices'] == choices[i]
                    assert person.request('submit', {'choices': list('ABABABABAB'), 'protocol': 2})['participant']['choices'] == choices[i]
                people.append((person, joined['ticket']))
            details = admin.request('details&id=' + session)
            assert details['completed'] == 3
            assert details['a_counts'] == [2, 2, 2, 2, 1, 1, 1, 1, 1, 1]
            draw = admin.request('finish', {'id': session})
            winners = draw['winners']
            assert len(winners) == len({w['ticket'] for w in winners}) == 2
            assert people[3][1] not in {w['ticket'] for w in winners}
            for winner in winners:
                i = [ticket for _, ticket in people].index(winner['ticket'])
                assert 1 <= winner['row'] <= 10 and 1 <= winner['die'] <= 10
                option = choices[i][winner['row'] - 1]
                assert winner['choice'] == option
                stakes = {'A': [400, 320], 'B': [770, 20]}[option]
                assert winner['cents'] == stakes[0 if winner['die'] <= winner['row'] else 1]
            assert sum(w['cents'] for w in winners) <= 1540
            assert admin.request('finish', {'id': session}) == draw
            assert admin.request('draw', {'id': session}) == draw
            admin.request('phase', {'id': session, 'state': 'open'}, expected=409)
            people[3][0].request('submit', {'choices': list('BBBBBBBBBB'), 'protocol': 2}, expected=409)
            new_session = admin.request('create', {'title': 'Synthetic reset', 'mode': 'practice'})['id']
            assert new_session != session
            state = people[0][0].request('state')
            assert state['active_id'] == new_session and state['participant'] is None
            assert admin.request('details&id=' + session)['session']['winners'] == winners
            admin.request('finish', {'id': new_session}, expected=409)
            assert admin.request('details&id=' + new_session)['session']['state'] == 'open'
            assert len(admin.request('selftest')['checks']) >= 7
            print('Passed: real PHP/SQLite join, submit, private results, origin/CSRF checks, saved two-winner draw, payments, reset, and lottery self-tests.')
        except Exception:
            log.flush()
            log.seek(0)
            print(log.read(), file=sys.stderr)
            raise
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
            log.close()


if __name__ == '__main__':
    main()
