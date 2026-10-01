# Holt and Laury Lottery

A small classroom risk-preference experiment for phones and a projector. Students scan one permanent QR code, enter a name, make ten A/B choices, and submit. Allow about two minutes; there is no countdown or forced cutoff.

The instructor closes submissions and immediately sees two randomly selected winners, their payments and paid rows, one class-choice chart, and the class average expected value (EV). Detailed calculations and individual choices stay collapsed. Resetting starts a new session at the same URL and keeps previous results.

Custom PHP, SQLite, and vanilla JavaScript. No oTree, MobLab, student accounts, or external service is required. Developed with AI assistance from GPT6-Astra.

## What gets paid?

| Option | High outcome | Low outcome |
| --- | ---: | ---: |
| A | CHF 4.00 | CHF 3.20 |
| B | CHF 7.70 | CHF 0.20 |

The probability of the high outcome rises from 10% in row 1 to 100% in row 10. These amounts preserve the original Holt–Laury ratios exactly, using twice the numerical values of the original USD payoffs in CHF.

After at least two completed submissions, **Close & draw** selects two distinct completed participants uniformly at random. Each gets an independently sampled row (1–10) and outcome. The instructor pays the displayed amounts manually. Incomplete submissions are excluded. The draw is saved atomically with closing and cannot be repeated to get different winners.

- Maximum total payment: **CHF 15.40**.
- Expected total payment: twice the class average EV, calculated from completed choices before the draw.
- Class average EV: the average payoff if selected, with all ten rows and all completed participants equally weighted.
- Practice mode uses the same procedure without a payment obligation.
- Green means higher monetary EV; red means lower monetary EV. This is a risk-neutral benchmark, not a judgment that risk-averse preferences are wrong.

The two-winner payment rule is a classroom adaptation. This is not a claim to reproduce every part of the original research protocol.

## Hosting requirements

- A web server with **PHP 8.1+**, **PDO_SQLite**, and writable private storage. `mbstring` is recommended for case-insensitive Unicode names.
- **HTTPS**, and Apache 2.4 with `mod_rewrite`, `mod_headers`, and `.htaccess` overrides enabled (common on cPanel shared hosting).
- Python 3.10+ on your computer to generate deployment settings and a QR code. Python is not needed on the web server.

GitHub hosts this source code. **GitHub Pages cannot run the PHP application.** Use PHP hosting or configure an equivalent PHP web server yourself. For Nginx or a reverse proxy, reproduce the canonical URL redirect and security headers in that server's configuration; the supplied Apache rules assume Apache sees the HTTPS connection directly.

## Install

1. Clone or download this repository. Open a terminal in its directory.
2. Install the local QR-generation dependency:

   ```sh
   python -m pip install -r requirements.txt
   ```

3. Choose the permanent student URL and an absolute **server** data path outside every public website directory. For cPanel this could be `/home/YOUR_USER/holt-laury-data`, alongside `public_html`, never inside it. Generate the deployment:

   ```sh
   python tools/configure.py --url https://example.org/experiment/ --data-dir /home/YOUR_USER/holt-laury-data
   ```

   Enter a private instructor access code of at least 12 characters, or press Enter to generate one. It remains the same across resets. There is no public default password. The generated `config.php` contains its hash, not the code itself.

4. Upload the **contents** of `build/experiment/`, including `.htaccess`, to the website directory served at your chosen URL, for example `public_html/experiment/`. Do not upload the repository, tests, or private data to the web directory. The PHP process must be able to create or write the private data directory.
5. Open `https://example.org/experiment/admin.html`, sign in, and run a practice session using at least two independent browsers or phones before class.

The build generates `join-qr.svg` for the configured URL. Put that SVG into your presentation, or project it from the instructor page. It stays valid when you reset the session. Moving to another URL requires generating a new QR.

The generated `.htaccess` redirects alternate hostnames (including `www`, when that hostname points at this site) to the configured canonical hostname before login. The alternate hostname must have working DNS and a valid TLS certificate. The API retains strict origin and CSRF checks, including support for local development ports. Always open the instructor page at the configured URL.

Keep `config.php`, deployment builds, recovery codes, databases, and exported CSV files private. `.gitignore` excludes common private files. The repository ships no real class data or hosting credentials. Back up the private data directory before upgrading; existing sessions retain their original payoff schedules.

### Local practice

With PHP and PDO_SQLite installed, generate a separate build using an absolute private data directory outside the build:

```sh
python tools/configure.py --url http://127.0.0.1:8080/ --data-dir /absolute/private/holt-laury-data --output build/local
php -S 127.0.0.1:8080 -t build/local
```

On Windows, use an absolute Windows path for `--data-dir`. Open `http://127.0.0.1:8080/admin.html`. PHP's built-in server ignores `.htaccess`; this is for local practice only, not public hosting or classroom load testing.

## Run a class

1. Sign in to `admin.html`. Choose **Practice** for a rehearsal, then **Start session**.
2. Project the QR code. Students enter a unique name or nickname, make all ten choices, and submit.
3. When ready, click **Close & draw**. Both winners and the main results appear together.
4. Pay the two displayed amounts in real-payment mode. Open **Details** only if you want the full EV breakdown. Use **Download results** for CSV.
5. Click **Reset** for the next class. Previous sessions remain available; the access code and QR stay the same.

Names identify classroom entries, not verified identities. A browser remembers its entry; a private recovery code can restore it. For paid classes, supervise participation so each student makes one entry. Capacity depends on the host; test with the class size and network you expect to use. The project has automated functional checks, not a large-class load-test certification.

## Development checks

Node.js 18+ runs the JavaScript checks; Python runs setup checks. The API integration check additionally needs PHP with PDO_SQLite on `PATH`. All fixtures are synthetic and integration checks create an isolated temporary database.

```sh
node tests/check-ev.cjs
node tests/check-expectations.cjs
node tests/check-projector.cjs
node tests/check-results.cjs
node tests/check-student.cjs
python -m unittest discover -s tests -p "test_*.py"
python tests/check-api.py
```

The integration check exercises registration, submission, origin/CSRF protection, closing, saved draws, session resets, and the payment calculations. CI runs these checks on each push.

## Credit and license

Experimental method: Charles A. Holt and Susan K. Laury (2002), “Risk Aversion and Incentive Effects,” *American Economic Review*, 92(5), 1644–1655. [DOI: 10.1257/000282802762024700](https://doi.org/10.1257/000282802762024700).

This independent implementation is available under the [MIT license](LICENSE). The license covers this project's code and documentation, not the original paper or other authors' materials. No paper text or third-party experiment software is bundled. No affiliation with or endorsement by the original authors is implied.

ReportLab is an external dependency used only by the local QR generator and retains its own BSD license. PHP, Python, and other development tools retain their respective licenses.
