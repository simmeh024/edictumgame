// When a click cannot reach an element because something else "intercepts pointer events", say why.
// traceInit (an init script) keeps a timeline of what the page did: scrolls, dialogs, inert and open attributes,
// focus, the main column redrawn, fonts, and the pointer events that arrived. hitDiag reads it and works out, for the
// element and each of its ancestors, whether the browser treats it as inert (an inert element cannot take focus, even
// with a tabindex), where along its column the element can be hit, and which nudge (a layout read, a scroll, a style
// change on its wrapper, an inert attribute set and cleared) makes it hittable again.
export function traceInit() {
  if (window.__tl) return;
  const T0 = performance.now(), tl = window.__tl = [];
  const d = e => !e || !e.tagName ? String(e && e.nodeName) : e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const L = (k, v) => { tl.push(Math.round(performance.now() - T0) + ' ' + k + (v !== undefined ? ' ' + v : '')); if (tl.length > 600) tl.splice(0, 100); };
  window.__tlLog = L;
  addEventListener('scroll', e => { const t = e.target; if (t === document || t === window) L('scroll', Math.round(scrollY)); else L('scroll-el', d(t) + ' ' + Math.round(t.scrollTop)); }, { capture: true, passive: true });
  addEventListener('focusin', e => L('focus', d(e.target)), true);
  addEventListener('close', e => L('close-ev', d(e.target)), true);
  addEventListener('resize', () => L('resize', innerWidth + 'x' + innerHeight));
  for (const t of ['pointerdown', 'pointerup', 'click']) addEventListener(t, e => L(t, Math.round(e.clientX) + ',' + Math.round(e.clientY) + ' ' + d(e.target) + (e.isTrusted ? '' : ' synthetic')), true);
  let moves = 0; addEventListener('pointermove', () => { moves++; }, true);
  const P = HTMLDialogElement.prototype;
  for (const k of ['showModal', 'show', 'close']) { const f = P[k]; P[k] = function () { L('dialog.' + k, d(this) + (this.isConnected ? '' : ' detached')); return f.apply(this, arguments); }; }
  const siv = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (o) { L('scrollIntoView', d(this) + ' ' + JSON.stringify(o)); return siv.apply(this, arguments); };
  for (const k of ['scrollTo', 'scrollBy', 'scroll']) { const f = window[k]; window[k] = function () { L('window.' + k, JSON.stringify([...arguments]).slice(0, 80)); return f.apply(this, arguments); }; }
  const rf = Element.prototype.requestFullscreen; if (rf) Element.prototype.requestFullscreen = function () { L('requestFullscreen', d(this)); return rf.apply(this, arguments); };
  try { document.fonts.addEventListener('loadingdone', () => L('fonts-done')); } catch (e) {}
  const start = () => {
    new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === 'attributes') L('attr ' + m.attributeName, d(m.target) + ' ' + (m.target.getAttribute(m.attributeName) === null ? 'removed' : 'set'));
        else if (m.target.id === 'app' || m.target.id === 'main' || m.target.classList?.contains('wrap') || m.target.classList?.contains('layout')) L('dom', d(m.target) + ' +' + m.addedNodes.length + ' -' + m.removedNodes.length + (m.addedNodes[0] ? ' ' + d(m.addedNodes[0]) : ''));
      }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['inert', 'open', 'hidden', 'popover'] });
    let h = 0; new ResizeObserver(() => { const n = document.documentElement.scrollHeight; if (n !== h) { h = n; L('docH', n + ' scrollY ' + Math.round(scrollY) + ' moves ' + moves); } }).observe(document.body);
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
}

export async function hitDiag(p, sel) {
  return p.evaluate(async sel => {
    const fr = () => new Promise(r => requestAnimationFrame(() => r()));
    const b = document.querySelector(sel); if (!b) return { button: false, tl: (window.__tl || []).slice(-80) };
    const d = e => !e || !e.tagName ? String(e && e.nodeName) : e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    const rect = () => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const hit = () => { const [x, y] = rect(), e = document.elementFromPoint(x, y); return e === b || b.contains(e) ? 'BUTTON' : d(e); };
    /* inert: an element that cannot take focus even with a tabindex (each ancestor tried in turn) */
    const ae = document.activeElement;
    const focusable = e => { const had = e.getAttribute('tabindex'); if (had === null) e.setAttribute('tabindex', '-1'); let ok = false; try { e.focus({ preventScroll: true }); ok = document.activeElement === e; } catch (x) {} if (had === null) e.removeAttribute('tabindex'); return ok; };
    const chain = []; for (let e = b; e && e !== document.documentElement; e = e.parentElement) { const s = getComputedStyle(e); chain.push(d(e) + (focusable(e) ? '' : ' INERT') + ` ov=${s.overflow} ct=${s.contain} cq=${s.containerType} cp=${s.clipPath} wc=${s.willChange} disp=${s.display}`); }
    try { ae && ae.focus && ae.focus({ preventScroll: true }); } catch (x) {}
    const [x] = rect(), art = b.closest('article');
    const col = []; for (let yy = 4; yy < innerHeight; yy += 16) { const e = document.elementFromPoint(x, yy); col.push(art && art.contains(e) ? 'A' : e && e.id === 'main' ? 'm' : e && e.closest && e.closest('.side') ? 's' : e ? '.' : '_'); }
    const R = e => { if (!e) return null; const r = e.getBoundingClientRect(); return [r.top, r.bottom, r.left, r.right].map(Math.round); };
    const vv = window.visualViewport;
    const out = { ua: navigator.userAgent.replace(/.*(HeadlessChrome\/[\d.]+|Chrome\/[\d.]+).*/, '$1'), hit: hit(), chain, col: col.join(''),
      rects: { button: R(b), article: R(art), wrap: R(document.querySelector('.wrap')), main: R(document.getElementById('main')), layout: R(document.querySelector('.layout')) },
      scrollY, scrollH: document.documentElement.scrollHeight, inner: [innerWidth, innerHeight], vv: vv && [vv.offsetTop, vv.pageTop, vv.width, vv.height, vv.scale],
      dialogs: [...document.querySelectorAll('dialog')].map(g => d(g) + (g.open ? ' open' : '') + (g.matches(':modal') ? ' modal' : '')),
      top: [...document.querySelectorAll(':modal,:popover-open,:fullscreen')].map(d), fs: d(document.fullscreenElement), inertAttr: [...document.querySelectorAll('[inert]')].map(d), active: d(document.activeElement) };
    /* nudges, from the least to the most: does any make the button hittable again? */
    const wrap = b.closest('.wrap') || b.parentElement, nudges = [];
    const tryIt = async (name, f) => { if (nudges.length && nudges[nudges.length - 1].endsWith('BUTTON')) return; try { f(); } catch (e) { nudges.push(name + ' threw ' + e); return; } await fr(); nudges.push(name + ' -> ' + hit()); };
    await tryIt('a frame', () => {});
    await tryIt('layout read', () => document.documentElement.getBoundingClientRect());
    await tryIt('scroll -1/+1', () => { scrollBy(0, -1); scrollBy(0, 1); });
    await tryIt('wrap style change', () => { wrap.style.outlineOffset = '1px'; });
    await tryIt('wrap inert on/off', () => { wrap.inert = true; wrap.getBoundingClientRect(); wrap.inert = false; });
    await tryIt('main inert on/off', () => { const m = document.getElementById('main'); m.inert = true; m.getBoundingClientRect(); m.inert = false; });
    await tryIt('html class', () => { document.documentElement.classList.toggle('hit-diag'); });
    out.nudges = nudges; out.tl = (window.__tl || []).slice(-120);
    return out;
  }, sel);
}
