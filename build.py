#!/usr/bin/env python3
"""Build the site in public/ from the game in game/edictum.html.

    npm ci              # once: installs the pinned Firebase SDK, esbuild and the fonts
    python3 build.py    # writes public/

The game is one HTML fragment: head material (title and styles), then the app div and one script.
This script turns it into a small page plus long-cached files, without changing the game's source:
  - the game's script, minified, as /assets/game.<hash>.js, and its styles with src/shim.css and the
    fonts' @font-face rules, minified, as /assets/app.<hash>.css. The names change whenever the
    content does, so Hosting lets browsers keep them for a year (firebase.json) and a returning
    player downloads only the small page until the next deploy;
  - the game's three typefaces (Bodoni Moda, Public Sans, IBM Plex Mono; SIL Open Font License),
    Latin and Latin Extended only, from the pinned Fontsource packages into /assets/fonts/, so no
    visitor's browser contacts Google for them;
  - src/stub.js in <head>: defines window.claude.use() before the game's script runs;
  - the Firebase compat SDK (app, auth, firestore), copied from node_modules into
    public/vendor/firebase/<version>/ so the site needs no CDN;
  - src/shim.js after the game: the Firebase-backed window.claude and the account control;
  - description, theme colour, Open Graph tags and icons.

Options: --site-url https://example.org (or SITE_URL) makes og:image, og:url and the
canonical link absolute, as link previews need. --no-minify keeps the code readable for
debugging. Minifying runs esbuild through Node; everything else is the Python standard library.
"""
import argparse
import gzip
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.join(ROOT, 'game', 'edictum.html')
SRC = os.path.join(ROOT, 'src')
SDK = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js']
APP_MARK = '<div id="app"></div>'
# (package, its CSS files, the family name the game's styles use)
FONTS = [
    ('@fontsource-variable/bodoni-moda', ['opsz.css', 'opsz-italic.css'], 'Bodoni Moda'),
    ('@fontsource-variable/public-sans', ['wght.css', 'wght-italic.css'], 'Public Sans'),
    ('@fontsource/ibm-plex-mono', ['400.css', '500.css', '600.css'], 'IBM Plex Mono'),
]
PRELOAD = ['bodoni-moda-latin-opsz-normal', 'public-sans-latin-wght-normal']  # used on the first screen

TITLE = 'Edictum'
DESCRIPTION = ('Edictum is a free multiplayer nation simulator. Found a nation, decide the issues on your desk, '
               'claim land on a shared map, and trade, ally or go to war with other players.')
OG_ALT = 'The Edictum seal beside the words: Edictum, a nation simulator.'


def fail(msg):
    sys.exit('build.py: ' + msg)


def read(path, mode='r'):
    with open(path, mode, **({} if 'b' in mode else {'encoding': 'utf-8'})) as f:
        return f.read()


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb' if isinstance(data, bytes) else 'w', **({} if isinstance(data, bytes) else {'encoding': 'utf-8'})) as f:
        f.write(data)


def firebase_version():
    pkg = os.path.join(ROOT, 'node_modules', 'firebase', 'package.json')
    if not os.path.exists(pkg):
        fail('node_modules/firebase is missing. Run "npm ci" first.')
    have = json.loads(read(pkg))['version']
    want = json.loads(read(os.path.join(ROOT, 'package.json')))['dependencies']['firebase']
    if have != want:
        fail('node_modules has firebase %s but package.json pins %s. Run "npm ci".' % (have, want))
    return have


def split_game(src):
    """The game is <title>, <meta>, <link> and <style> (head material), then the app div and one script."""
    if src.count(APP_MARK) != 1:
        fail('expected exactly one %s in the game file' % APP_MARK)
    head, body = src.split(APP_MARK)
    if '<script' in head.lower():
        fail('the game has a script before the app div; build.py expects all of it after')
    if body.count('<script>') != 1 or body.count('</script>') != 1 or not body.rstrip().endswith('</script>'):
        fail('expected the game to end with exactly one inline <script>')
    return head.strip(), (APP_MARK + body).strip()


def inline_js(path, minify):
    js = esbuild(read(path), 'js', minify)
    if '</script' in js.lower():
        fail(path + ' must not contain "</script"')
    return js.strip()


ESBUILD = ("const s=[];process.stdin.on('data',d=>s.push(d)).on('end',()=>{"
           "const r=require('esbuild').transformSync(Buffer.concat(s).toString('utf8'),"
           "{loader:process.argv[1],minify:true,charset:'utf8',logLevel:'error'});process.stdout.write(r.code);});")


def esbuild(text, loader, minify):
    """Minify JavaScript or CSS with the pinned esbuild (through Node, the same on every system)."""
    if not minify:
        return text
    if not os.path.isdir(os.path.join(ROOT, 'node_modules', 'esbuild')):
        fail('node_modules/esbuild is missing. Run "npm ci" first.')
    try:
        r = subprocess.run(['node', '-e', ESBUILD, loader], input=text.encode('utf-8'), capture_output=True, cwd=ROOT)
    except FileNotFoundError:
        fail('Node.js is needed to minify (or pass --no-minify)')
    if r.returncode:
        fail('esbuild could not minify the %s:\n%s' % (loader, r.stderr.decode('utf-8', 'replace')[-2000:]))
    return r.stdout.decode('utf-8')


def hashed(out, name, ext, data):
    """Write public/assets/<name>.<hash>.<ext> and return its address."""
    raw = data if isinstance(data, bytes) else data.encode('utf-8')
    fn = '%s.%s.%s' % (name, hashlib.sha256(raw).hexdigest()[:10], ext)
    write(os.path.join(out, 'assets', fn), raw)
    return '/assets/' + fn


def fonts_css(out):
    """The @font-face rules for the game's typefaces, Latin and Latin Extended, with each font file
    copied to /assets/fonts/ under a name that carries its hash. Returns (css, preload addresses)."""
    rules, preload = [], []
    for pkg, files, family in FONTS:
        base = os.path.join(ROOT, 'node_modules', *pkg.split('/'))
        if not os.path.isdir(base):
            fail('node_modules/%s is missing. Run "npm ci" first.' % pkg)
        for f in files:
            for name, body in re.findall(r'/\*\s*([a-z0-9-]+)\s*\*/\s*@font-face\s*\{([^}]*)\}', read(os.path.join(base, f))):
                m = re.search(r'url\(\./files/([^)]+\.woff2)\)', body)
                if not m or not re.search(r'-latin(-ext)?-', name):
                    continue
                url = hashed(out, 'fonts/' + m.group(1)[:-len('.woff2')], 'woff2', read(os.path.join(base, 'files', m.group(1)), 'rb'))
                body = re.sub(r"font-family:\s*'[^']*'", "font-family: '%s'" % family, body)
                rules.append('@font-face {%s}' % body.replace(m.group(0), 'url(%s)' % url).strip())
                if name in PRELOAD:
                    preload.append(url)
    if len(preload) != len(PRELOAD):
        fail('the fonts to preload were not found: %s' % ', '.join(PRELOAD))
    return '\n'.join(rules), preload


def main():
    ap = argparse.ArgumentParser(description='Build public/ for Firebase Hosting.')
    ap.add_argument('--site-url', default=os.environ.get('SITE_URL', ''),
                    help='the live address, such as https://edictum.example (also read from SITE_URL)')
    ap.add_argument('--out', default=os.path.join(ROOT, 'public'), help='output folder (default: public)')
    ap.add_argument('--game', default=GAME, help='the game file (default: game/edictum.html)')
    ap.add_argument('--no-minify', action='store_true', help='keep the code as written (for debugging)')
    args = ap.parse_args()
    minify = not args.no_minify
    site = args.site_url.strip().rstrip('/')
    if site and not site.startswith(('https://', 'http://')):
        fail('--site-url must start with https://')
    out = os.path.abspath(args.out)

    ver = firebase_version()
    game = read(args.game)
    game_head, game_body = split_game(game)

    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)

    vendor = '/vendor/firebase/%s/' % ver
    for name in SDK:
        for f in (name, name + '.map'):
            p = os.path.join(ROOT, 'node_modules', 'firebase', f)
            if os.path.exists(p):
                write(os.path.join(out, 'vendor', 'firebase', ver, f), read(p, 'rb'))
            elif f == name:
                fail('node_modules/firebase/%s is missing' % f)
    for f in ('favicon.svg', 'apple-touch-icon.png', 'og.png', 'privacy.html', 'privacidad.html', 'terms.html', 'terminos.html'):
        shutil.copyfile(os.path.join(SRC, f), os.path.join(out, f))  # the pages are served as /privacy, /privacidad, /terms, /terminos

    # the game's styles (with the shim's and the fonts') and its script become long-cached files
    styles = re.findall(r'<style[^>]*>(.*?)</style>', game_head, re.S | re.I)
    game_head = re.sub(r'\s*<style[^>]*>.*?</style>', '', game_head, flags=re.S | re.I).strip()
    if re.search(r'<link[^>]+fonts\.(googleapis|gstatic)\.com', game_head, re.I):
        fail('the game still loads Google Fonts; the build serves the fonts itself')
    fonts, preload = fonts_css(out)
    css_url = hashed(out, 'app', 'css', esbuild('\n'.join([fonts] + styles + [read(os.path.join(SRC, 'shim.css'))]), 'css', minify))
    script = re.search(r'<script>(.*)</script>\s*$', game_body, re.S).group(1)
    js_url = hashed(out, 'game', 'js', esbuild(script, 'js', minify))

    a = lambda path: (site + path) if site else path
    e = lambda s: html.escape(s, quote=True)
    meta = [
        '<meta name="description" content="%s">' % e(DESCRIPTION),
        '<meta name="theme-color" content="#e8eeeb" media="(prefers-color-scheme: light)">',
        '<meta name="theme-color" content="#0c1615" media="(prefers-color-scheme: dark)">',
        '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="%s">' % TITLE,
        '<meta property="og:title" content="%s">' % TITLE,
        '<meta property="og:description" content="%s">' % e(DESCRIPTION),
        '<meta property="og:image" content="%s">' % e(a('/og.png')),
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta property="og:image:alt" content="%s">' % e(OG_ALT),
        '<meta property="og:locale" content="en_GB">',
        '<meta name="twitter:card" content="summary_large_image">',
    ]
    if site:
        meta += ['<meta property="og:url" content="%s/">' % e(site), '<link rel="canonical" href="%s/">' % e(site)]

    stamp = hashlib.sha256(game.encode('utf-8')).hexdigest()[:12]
    page = '\n'.join([
        '<!doctype html>',
        '<html lang="en-GB">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
        '<!-- Edictum: built by build.py from game/edictum.html (sha256 %s) with Firebase %s -->' % (stamp, ver),
        '<style>body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style>',
        '<script>\n%s\n</script>' % inline_js(os.path.join(SRC, 'stub.js'), minify),
    ] + ['<script defer src="%s%s"></script>' % (vendor, n) for n in SDK] + meta + [
        game_head,
    ] + ['<link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>' % u for u in preload] + [
        '<link rel="stylesheet" href="%s">' % css_url,
        '</head>',
        '<body>',
        APP_MARK,
        '<script src="%s"></script>' % js_url,
        '<script>\n%s\n</script>' % inline_js(os.path.join(SRC, 'shim.js'), minify),
        '</body>',
        '</html>',
        '',
    ])
    write(os.path.join(out, 'index.html'), page)
    write(os.path.join(out, '404.html'), NOT_FOUND)
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(out) for f in fs)
    kb = lambda url: '%d KB, %d KB gzipped' % (os.path.getsize(os.path.join(out, url.lstrip('/'))) // 1024,
                                              len(gzip.compress(read(os.path.join(out, url.lstrip('/')), 'rb'), 9)) // 1024)
    print('build.py: wrote %s (page %d KB; game %s; styles %s; %d KB of Firebase %s; %.1f MB in all)%s' % (
        os.path.relpath(out, ROOT), len(page.encode('utf-8')) // 1024, kb(js_url), kb(css_url),
        sum(os.path.getsize(os.path.join(out, 'vendor', 'firebase', ver, n)) for n in SDK) // 1024, ver, size / 1e6,
        '' if site else '; no --site-url, so Open Graph links are relative'))


NOT_FOUND = '''<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Not on the map · Edictum</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root{--paper:#e8eeeb;--sheet:#f8fbf9;--ink:#12292a;--ink-2:#45605c;--rule:#cdd9d4;--accent:#1d6a5c}
  @media (prefers-color-scheme: dark){:root{--paper:#0c1615;--sheet:#12201f;--ink:#e1ebe7;--ink-2:#a0b6b1;--rule:#233634;--accent:#5ec2a9}}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);font:400 16px/1.6 system-ui,sans-serif}
  main{max-width:440px;margin:16px;padding:32px 28px;background:var(--sheet);border:1px solid var(--rule);border-radius:4px}
  h1{margin:16px 0 8px;font:italic 600 34px/1.1 Georgia,"Times New Roman",serif}
  p{margin:0 0 16px;color:var(--ink-2)}
  a{color:var(--accent);font-weight:600}
</style>
</head>
<body>
<main>
  <img src="/favicon.svg" width="56" height="56" alt="">
  <h1>Not on the map</h1>
  <p>No page lives at this address. The whole of Edictum is on its front page.</p>
  <p><a href="/">Go to Edictum</a></p>
</main>
</body>
</html>
'''

if __name__ == '__main__':
    main()
