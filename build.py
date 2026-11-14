#!/usr/bin/env python3
"""Build the site in public/ from the game in game/edictum.html.

    npm ci              # once: installs the pinned Firebase SDK, esbuild and the fonts
    python3 build.py    # writes public/

The game is one HTML fragment: head material (title and styles), then the app div and one script.
This script turns it into a small page plus long-cached files, without changing the game's source:
  - the game's code as /assets/game.<hash>.js, with static fiction cached separately in
    /assets/content.<hash>.js so code-only updates do not download all the stories again;
    and its styles with src/shim.css and the
    fonts' @font-face rules, minified, as /assets/app.<hash>.css. The names change whenever the
    content does, so Hosting lets browsers keep them for a year (firebase.json) and a returning
    player downloads only the small page until the next deploy;
  - every region's map, made at build time by the game's own generators and checked against them
    (scripts/bake-maps.mjs), as /assets/maps.<hash>.js, so a page decodes its map instead of generating it;
    its biomes and large iron deposits go with it, worked out and checked the same way;
  - the game's three typefaces (Bodoni Moda, Public Sans, IBM Plex Mono; SIL Open Font License),
    Latin and Latin Extended only, from the pinned Fontsource packages into /assets/fonts/, so no
    visitor's browser contacts Google for them;
  - src/stub.js in <head>: defines window.claude.use() before the game's script runs;
  - the Firebase compat SDK (app, auth, firestore), copied from node_modules into
    public/vendor/firebase/<version>/ so the site needs no CDN, and loaded after the first paint (game_loader);
  - src/shim.js after the game: the Firebase-backed window.claude and the account control;
  - Firebase Performance Monitoring as /assets/perf.<hash>.js, edited so it reports no player IDs (PERF_EDITS),
    which the shim loads only for a player who allowed visit statistics;
  - the build, a hash of the page, in its meta edictum-build and in /version.json, by which an open tab
    learns that a newer one has been deployed (src/shim.js reloads it);
  - description, theme colour, Open Graph tags, icons and schema.org data for search engines;
  - the top of the front page as plain HTML, shown while the game's script downloads (see BOOT).

Options: --site-url https://example.org (or SITE_URL) makes og:image, og:url and the
canonical link absolute, as link previews need. --no-minify keeps the code readable for
debugging. Minifying (esbuild) and baking the maps run through Node; everything else is the Python
standard library.
"""
import argparse
import base64
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
# Firebase Performance Monitoring, as /assets/perf.<hash>.js: src/shim.js loads it only for a player who allowed visit
# statistics. It reports the address of the page and of everything the page downloads, so two edits keep player IDs
# out of what it sends: the page's address loses its #hash (#visit/<id>), and every other address goes through
# src/perf-url.js, which keeps only the host of other sites and blanks the IDs in Firebase's paths (nations/<uid>).
# A newer Firebase that changes either line stops the build here, rather than sending addresses unmasked.
PERF_SDK = 'firebase-performance-compat.js'
PERF_EDITS = [
    ('getUrl(){return this.windowLocation.href.split("?")[0]}',
     'getUrl(){return this.windowLocation.href.split(/[?#]/)[0]}'),
    ('url:a.name&&a.name.split("?")[0],',
     'url:a.name&&self.edictumPerfUrl(a.name),'),
]
APP_MARK = '<div id="app"></div>'
BUILD_MARK = '__EDICTUM_BUILD__'  # the page's own build, filled in once the page is complete
# (package, its CSS files, the family name the game's styles use)
FONTS = [
    ('@fontsource-variable/bodoni-moda', ['opsz.css', 'opsz-italic.css'], 'Bodoni Moda'),
    ('@fontsource-variable/public-sans', ['wght.css', 'wght-italic.css'], 'Public Sans'),
    ('@fontsource/ibm-plex-mono', ['400.css', '500.css', '600.css'], 'IBM Plex Mono'),
    ('@fontsource-variable/cinzel', ['wght.css'], 'Cinzel'),  # Roman capitals: edicts, decrees, passports
    # the Diplomata's typefaces for passports: a browser downloads one only when a passport on screen uses it
    ('@fontsource/cormorant-garamond', ['600.css'], 'Cormorant Garamond'),
    ('@fontsource/unifrakturmaguntia', ['400.css'], 'UnifrakturMaguntia'),
    ('@fontsource/great-vibes', ['400.css'], 'Great Vibes'),
    ('@fontsource/courier-prime', ['400.css', '700.css'], 'Courier Prime'),
    ('@fontsource/bebas-neue', ['400.css'], 'Bebas Neue'),
]
PRELOAD = ['bodoni-moda-latin-opsz-normal', 'public-sans-latin-wght-normal']  # used on the first screen

TITLE = 'Edictum'
DESCRIPTION = ('Edictum is a free multiplayer nation simulator. Found a nation, rule on the edicts that reach your desk, '
               'claim land on a shared map, and trade, ally or go to war with other players.')
OG_ALT = 'The Edictum seal beside the words: Edictum, a nation simulator.'
# What #app holds until the game draws itself, which takes as long as its script takes to download. A
# newcomer sees the top of the front page (the founding page) as the game will draw it, with its heading
# copy read from the game's HOME_LEDE, HOME_FEATS and HOME_FREE; a returning player (src/stub.js marks
# them) sees the plain loading screen instead. Anything that does not run the game's script (search
# engines, link previews, Google's review of the sign-in branding) gets what Edictum is and where its
# privacy notice and terms are.
LEGAL = ('<p class="boot-legal"><a href="/privacy">Privacy notice</a> · <a href="/terms">Terms of use</a> · '
         '<a href="/pricing">Prices</a> · <a href="/refunds">Refund policy</a> · '
         '<a href="/privacidad" lang="es">Aviso de privacidad</a> · <a href="/terminos" lang="es">Términos de uso</a></p>')
LOADING = ('<p class="boot-load" role="status">Loading the game…</p>'
           '<noscript><p class="boot-load">Edictum needs JavaScript to run.</p></noscript>')
BOOT = ('<div id="app"><div class="found home-static">'
        '<header class="found-head"><span class="wordmark">Edictum</span><span class="brand-sub">A nation simulator</span></header>'
        '<div class="hm-top"><div class="found-intro"><p class="eyebrow">Charter of foundation</p><h1 class="display">Found a nation</h1>'
        '<p class="lede">%(lede)s</p><ul class="hm-feats">%(feats)s</ul><p class="hm-free">%(free)s</p>' + LOADING + '</div></div>'
        + LEGAL + '</div>'
        '<main class="boot"><p class="boot-mark">Edictum</p><p class="boot-sub">%(desc)s</p>' + LOADING + LEGAL + '</main></div>')


# origins every visit talks to soon after load (sign-in, then Firestore): connecting early saves a round trip each
PRECONNECT = ['https://identitytoolkit.googleapis.com', 'https://firestore.googleapis.com']

# The Content-Security-Policy of every page, as a <meta> (with_csp): the hashes of the pages' own inline scripts
# change with each build, which firebase.json's fixed headers could not follow. Scripts run only from this site,
# the inline scripts the build wrote (by hash), Google's sign-in (apis.google.com, which Firebase's pop-up sign-in
# loads), Google Analytics (only after the player allows it: src/shim.js) and Paddle (the Shop). So a player's
# words that slipped past the game's escaping still could not run as script. Styles stay open to inline ones (the
# game sets style attributes everywhere); images may come from anywhere over https (none is ever a script).
# 127.0.0.1 and localhost are the emulators' (the tests'); a page served from the site cannot use them for harm.
CSP = [
    ('default-src', ["'self'"]),
    ('script-src', ["'self'", 'https://apis.google.com', 'https://www.googletagmanager.com', 'https://*.googletagmanager.com',
                    'https://cdn.paddle.com']),
    ('style-src', ["'self'", "'unsafe-inline'", 'https://cdn.paddle.com']),
    ('img-src', ["'self'", 'data:', 'blob:', 'https:']),
    ('font-src', ["'self'", 'data:']),
    ('media-src', ["'self'", 'data:', 'blob:']),
    ('connect-src', ["'self'", 'https://*.googleapis.com', 'https://*.cloudfunctions.net', 'https://*.run.app',
                     'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com',
                     'https://*.paddle.com', 'https://api.github.com', 'https://www.google.com',
                     'https://apis.google.com',  # Google sign-in's loader pings it (gen_204)
                     'http://127.0.0.1:*', 'http://localhost:*', 'ws://127.0.0.1:*', 'ws://localhost:*']),
    ('frame-src', ["'self'", 'https://*.firebaseapp.com', 'https://*.web.app', 'https://apis.google.com',
                   'https://accounts.google.com', 'https://*.paddle.com',
                   'http://127.0.0.1:*', 'http://localhost:*']),  # the Auth emulator's sign-in frame
    ('worker-src', ["'self'", 'blob:']),
    ('manifest-src', ["'self'"]),
    ('object-src', ["'none'"]),
    ('base-uri', ["'self'"]),
    ('form-action', ["'self'"]),
]
INLINE_SCRIPT = re.compile(r'<script(\s[^>]*)?>(.*?)</script>', re.S | re.I)
NOT_JS = re.compile(r'''\bsrc\s*=|\btype\s*=\s*["']?application/(ld\+)?json''', re.I)


def with_csp(page):
    """The page with its Content-Security-Policy as the first thing after <meta charset>, so it covers every script
    after it: each inline script (not a data block such as the JSON-LD) by the hash of its exact text."""
    hashes = []
    for attrs, body in INLINE_SCRIPT.findall(page):
        if attrs and NOT_JS.search(attrs):
            continue
        h = "'sha256-%s'" % base64.b64encode(hashlib.sha256(body.encode('utf-8')).digest()).decode('ascii')
        if h not in hashes:
            hashes.append(h)
    policy = '; '.join('%s %s' % (k, ' '.join(v + hashes if k == 'script-src' else v)) for k, v in CSP)
    m = re.search(r'<meta charset="utf-8">', page, re.I)
    if not m:
        fail('a page without <meta charset="utf-8"> cannot carry its Content-Security-Policy')
    return page[:m.end()] + '\n<meta http-equiv="Content-Security-Policy" content="%s">' % html.escape(policy, quote=False) + page[m.end():]


def game_loader(scripts):
    """An inline script that loads the game's scripts after the front page has painted: at the first frame it
    starts their downloads (preload), and once the fonts are in (at most 1.5 s) and one more frame is painted it
    adds them, in order (async=false). Compiling the game blocks the page for seconds on a phone, so the front
    page's own text must be on screen first. A tab in the background (no frames) adds them at once, and so
    does the load event, at the latest. A failed download of one marked True shows the loader's retry message
    (window.__edictum.bootError)."""
    return ('(function(){var L=%s,d=document;function pre(){if(pre.d)return;pre.d=1;L.forEach(function(x){var l=d.createElement("link");'
            'l.rel="preload";l.as="script";l.href=x[0];d.head.appendChild(l)})}'
            'function go(){if(go.d)return;go.d=1;pre();window.__edictum.loading=1;L.forEach(function(x){var s=d.createElement("script");'
            's.src=x[0];s.async=false;if(x[1])s.onerror=function(){window.__edictum.bootError()};d.body.appendChild(s)})}'
            'function frame(f){requestAnimationFrame(function(){setTimeout(f,0)})}'
            'if(d.hidden||!window.requestAnimationFrame)go();else{frame(pre);'
            'var f=d.fonts&&d.fonts.ready?Promise.race([d.fonts.ready,new Promise(function(r){setTimeout(r,1500)})]):Promise.resolve();'
            'f.then(function(){frame(go)});setTimeout(go,3000);window.addEventListener("load",go)}})();'
            % json.dumps([[u, bool(f)] for u, f in scripts]))


def font_preloader(urls):
    """An inline script that preloads the first screen's fonts, unless the browser reckons the connection slow (2G or
    3G, or Data Saver on). There the fonts would share the line with the stylesheet that holds the first paint back:
    on a 3G line they cost it about 1.5 s. They still come, a moment later, when the stylesheet asks for them
    (font-display: swap). A browser that makes no estimate (Safari, Firefox) preloads them, as every browser did."""
    return ('(function(){var c=navigator.connection;if(c&&(c.saveData||/^(slow-2g|2g|3g)$/.test(c.effectiveType)))return;'
            '%s.forEach(function(u){var l=document.createElement("link");l.rel="preload";l.as="font";l.type="font/woff2";'
            'l.crossOrigin="anonymous";l.href=u;document.head.appendChild(l)})})();' % json.dumps(urls))


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


def js_text(script, name):
    """A constant of the game's that holds one string in single quotes, as text."""
    m = re.search(r"\bconst %s='((?:[^'\\\n]|\\.)*)';" % name, script)
    if not m:
        fail('the game has no %s constant; build.py writes it into the page' % name)
    return re.sub(r'\\(.)', r'\1', m.group(1))


def home_copy(script):
    """The front page's heading copy, from the game's own constants (see "the front page" in the game)."""
    m = re.search(r"\bconst HOME_FEATS=\[(.*?)\];", script)
    feats = re.findall(r"\['([a-z]+)','((?:[^'\\]|\\.)*)'\]", m.group(1)) if m else []
    if not feats:
        fail('the game has no HOME_FEATS list of [icon, text] pairs; build.py writes it into the page')
    e = lambda s: html.escape(s, quote=False)
    return {
        'lede': e(js_text(script, 'HOME_LEDE')),
        'feats': ''.join('<li><span class="hm-ic ai-%s" aria-hidden="true"></span>%s</li>' % (k, e(re.sub(r'\\(.)', r'\1', t)))
                         for k, t in feats),
        'free': e(js_text(script, 'HOME_FREE')),
    }


def inline_js(path, minify):
    js = esbuild(read(path), 'js', minify)
    if '</script' in js.lower():
        fail(path + ' must not contain "</script"')
    return js.strip()


INFLATE = ("const r=require('esbuild').buildSync({stdin:{contents:\"import{inflateSync}from'fflate';"
           "self.edictumInflate=inflateSync;\",resolveDir:process.cwd()},bundle:true,format:'iife',minify:true,"
           "write:false,charset:'utf8',logLevel:'error'});process.stdout.write(r.outputFiles[0].text);")


def inflate_js():
    """fflate's synchronous inflate (about 3 KB) as self.edictumInflate, for src/shim.js: nations/ records are
    stored deflated (field z) and the game reads them synchronously."""
    if not os.path.isdir(os.path.join(ROOT, 'node_modules', 'fflate')):
        fail('node_modules/fflate is missing. Run "npm ci" first.')
    try:
        r = subprocess.run(['node', '-e', INFLATE], capture_output=True, cwd=ROOT)
    except FileNotFoundError:
        fail('Node.js is needed to bundle fflate')
    if r.returncode:
        fail('esbuild could not bundle fflate:\n%s' % r.stderr.decode('utf-8', 'replace')[-2000:])
    return r.stdout.decode('utf-8').strip()


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


def perf_js(minify):
    """src/perf-url.js, then the Performance Monitoring SDK with PERF_EDITS made, as one script."""
    p = os.path.join(ROOT, 'node_modules', 'firebase', PERF_SDK)
    if not os.path.exists(p):
        fail('node_modules/firebase/%s is missing' % PERF_SDK)
    sdk = read(p)
    for old, new in PERF_EDITS:
        if sdk.count(old) != 1:
            fail('%s no longer has %r exactly once: find that line in this Firebase version and update PERF_EDITS, '
                 'so its reports keep leaving player IDs out' % (PERF_SDK, old))
        sdk = sdk.replace(old, new)
    sdk = re.sub(r'\s*//# sourceMappingURL=\S+\s*$', '', sdk)
    return inline_js(os.path.join(SRC, 'perf-url.js'), minify) + '\n' + sdk.strip() + '\n'


def split_content(script):
    """Acorn extracts only literal text in static catalogs, leaving their closures in the game."""
    try:
        r = subprocess.run(['node', os.path.join(ROOT, 'scripts', 'split-content.mjs')],
                           input=script.encode('utf-8'), capture_output=True, cwd=ROOT)
    except FileNotFoundError:
        fail('Node.js is needed to split the game content. Run npm ci first.')
    if r.returncode:
        fail('could not split the game content (run npm ci first):\n' + r.stderr.decode('utf-8', 'replace')[-2000:])
    return json.loads(r.stdout)


def bake_maps(script):
    """Every region's map, made by the game's own generators and checked hex for hex against them
    (scripts/bake-maps.mjs), as a script that sets window.__edictum.maps before the game runs."""
    try:
        r = subprocess.run(['node', os.path.join(ROOT, 'scripts', 'bake-maps.mjs')],
                           input=script.encode('utf-8'), capture_output=True, cwd=ROOT)
    except FileNotFoundError:
        fail('Node.js is needed to bake the maps')
    if r.returncode:
        fail('could not bake the maps:\n' + r.stderr.decode('utf-8', 'replace')[-2000:])
    return r.stdout.decode('utf-8')


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
                body = re.sub(r",\s*url\(\./files/[^)]+\.woff\)\s*format\('woff'\)", '', body)  # the woff2 is enough
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
    for f in ('favicon.svg', 'apple-touch-icon.png', 'og.png', 'privacy.html', 'privacidad.html', 'terms.html', 'terminos.html', 'discord.html', 'mail.html',
              'pricing.html', 'precios.html', 'refunds.html', 'reembolsos.html', 'push-sw.js'):
        # served as /privacy, /privacidad, /terms, /terminos, /discord, /mail, /pricing, /precios, /refunds, /reembolsos
        if f.endswith('.html'):
            write(os.path.join(out, f), with_csp(read(os.path.join(SRC, f))))
        else:
            shutil.copyfile(os.path.join(SRC, f), os.path.join(out, f))

    # the game's styles (with the shim's and the fonts') and its script become long-cached files
    styles = re.findall(r'<style[^>]*>(.*?)</style>', game_head, re.S | re.I)
    game_head = re.sub(r'\s*<style[^>]*>.*?</style>', '', game_head, flags=re.S | re.I).strip()
    if re.search(r'<link[^>]+fonts\.(googleapis|gstatic)\.com', game_head, re.I):
        fail('the game still loads Google Fonts; the build serves the fonts itself')
    fonts, preload = fonts_css(out)
    css_url = hashed(out, 'app', 'css', esbuild('\n'.join([fonts] + styles + [read(os.path.join(SRC, 'shim.css'))]), 'css', minify))
    script = re.search(r'<script>(.*)</script>\s*$', game_body, re.S).group(1)
    # the shop's catalogue: the very file the server sells from (functions/shop-catalogue.json)
    if '/*SHOP_CATALOGUE*/null' not in script:
        fail('the game no longer marks where the shop catalogue goes (/*SHOP_CATALOGUE*/null)')
    catalogue = json.loads(read(os.path.join(ROOT, 'functions', 'shop-catalogue.json')))
    script = script.replace('/*SHOP_CATALOGUE*/null', json.dumps(catalogue, ensure_ascii=False, separators=(',', ':')))
    content_url = None
    if minify:
        parts = split_content(script)
        content_url = hashed(out, 'content', 'js', esbuild(parts['content'], 'js', True))
        js_url = hashed(out, 'game', 'js', esbuild(parts['code'], 'js', True))
    else:
        # A debug build keeps the original, unsplit source easy to inspect.
        js_url = hashed(out, 'game', 'js', script)
    # every region's map, long-cached on its own: it changes only when the generators or the regions do
    maps_url = hashed(out, 'maps', 'js', bake_maps(script))
    # the Firebase adapter runs after the game, so it is a deferred file of its own (an inline script cannot wait)
    # speed statistics, which the shim loads for a player who allowed visit statistics (PERF_SDK); it learns the address here
    perf_url = hashed(out, 'perf', 'js', perf_js(minify))
    shim_url = hashed(out, 'shim', 'js', inflate_js() + '\n' + 'self.edictumPerfSdk=%s;\n' % json.dumps(perf_url) +
                      inline_js(os.path.join(SRC, 'shim.js'), minify))

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
    # what search engines read about the game (schema.org)
    ld = {'@context': 'https://schema.org', '@type': 'VideoGame', 'name': TITLE, 'description': DESCRIPTION,
          'genre': ['Nation simulation', 'Strategy'], 'gamePlatform': 'Web browser', 'operatingSystem': 'Any',
          'applicationCategory': 'Game', 'playMode': 'MultiPlayer', 'inLanguage': 'en-GB', 'isAccessibleForFree': True,
          'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'}, 'image': a('/og.png')}
    if site:
        ld['url'] = site + '/'
    meta.append('<script type="application/ld+json">%s</script>' % json.dumps(ld, ensure_ascii=False).replace('</', '<\\/'))

    stamp = hashlib.sha256(game.encode('utf-8')).hexdigest()[:12]
    page = '\n'.join([
        '<!doctype html>',
        '<html lang="en-GB">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
        '<!-- Edictum: built by build.py from game/edictum.html (sha256 %s) with Firebase %s -->' % (stamp, ver),
        '<meta name="edictum-build" content="%s">' % BUILD_MARK,
        '<style>html{background:#e8eeeb;color-scheme:light}body{margin:0;background:inherit;font:14px system-ui}'
        'html[data-theme="dark"]{background:#0c1615;color-scheme:dark}'
        '@media(prefers-color-scheme:dark){html:not([data-theme="light"]){background:#0c1615;color-scheme:dark}}'
        '[hidden]{display:none!important}'
        '.ed-boot-pending .boot,.ed-boot-pending .home-static .boot-load{visibility:hidden}</style>',
        '<script>\n%s\n</script>' % inline_js(os.path.join(SRC, 'stub.js'), minify),
    ] + ['<link rel="preconnect" href="%s" crossorigin>' % u for u in PRECONNECT] + meta + [
        game_head,
        '<script>\n%s\n</script>' % font_preloader(preload),
        '<link rel="stylesheet" href="%s">' % css_url,
        '</head>',
        '<body>',
        BOOT % dict(home_copy(script), desc=e(DESCRIPTION)),
        # The front page above (BOOT) paints first, with its fonts: the game's scripts download from the first
        # frame and run after it, in this order, the adapter (shim) last (see game_loader). Run as plain or
        # deferred scripts, compiling 3.5 MB of game held the first paint back by seconds on a phone.
        # Without the maps (a failed download) the game generates its map, as it can. The Firebase SDK (180 KB
        # compressed) waits for the first frame too: as deferred scripts in the head it downloaded alongside the
        # stylesheet, which on a 3G line held the first paint back by about 3 s. It goes first, so it compiles
        # while the game is still downloading rather than after it; only the shim uses it. Without it (a failed
        # download) the shim plays offline, as it always has.
        '<script>\n%s\n</script>' % game_loader([(vendor + n, False) for n in SDK] + [(maps_url, False)] +
                                                ([(content_url, True)] if content_url else []) +
                                                [(js_url, True), (shim_url, False)]),
        '</body>',
        '</html>',
        '',
    ])
    # The build: a hash of the page, which names every asset and carries the shim, so any change to what a
    # player runs changes it. An open tab compares its own with /version.json to learn of a newer deploy (shim.js).
    build = hashlib.sha256(page.encode('utf-8')).hexdigest()[:12]
    page = with_csp(page.replace(BUILD_MARK, build))
    write(os.path.join(out, 'index.html'), page)
    write(os.path.join(out, 'version.json'), json.dumps({'b': build}) + '\n')
    write(os.path.join(out, '404.html'), with_csp(NOT_FOUND))
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(out) for f in fs)
    kb = lambda url: '%d KB, %d KB gzipped' % (os.path.getsize(os.path.join(out, url.lstrip('/'))) // 1024,
                                              len(gzip.compress(read(os.path.join(out, url.lstrip('/')), 'rb'), 9)) // 1024)
    print('build.py: wrote %s (page %d KB; game %s; styles %s; %d KB of Firebase %s; %.1f MB in all)%s' % (
        os.path.relpath(out, ROOT), len(page.encode('utf-8')) // 1024, kb(js_url), kb(css_url),
        sum(os.path.getsize(os.path.join(out, 'vendor', 'firebase', ver, n)) for n in SDK) // 1024, ver, size / 1e6,
        '' if site else '; no --site-url, so Open Graph links are relative'))
    if content_url:
        print('build.py: independently cached story text: %s (%s); code-only updates reuse it' % (content_url, kb(content_url)))
    print('build.py: baked maps of every region: %s (%s)' % (maps_url, kb(maps_url)))


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
