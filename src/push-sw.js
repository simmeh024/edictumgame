/* Edictum's push notifications for letters and important development news (functions/letters.js sends them;
   Settings › Letters turns them on). This worker does nothing else: no caching, no fetch handler. A letter's
   notification says who wrote, never what. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  const title = typeof d.title === 'string' && d.title ? d.title.slice(0, 120) : 'A letter has arrived';
  const body = typeof d.body === 'string' ? d.body.slice(0, 200) : '';
  const url = typeof d.url === 'string' && d.url.charAt(0) === '/' ? d.url : '/#messages';
  e.waitUntil(self.registration.showNotification(title, { body, tag: typeof d.tag === 'string' ? d.tag.slice(0, 160) : 'letter', renotify: true, icon: '/apple-touch-icon.png', badge: '/favicon.svg', data: { url } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/#messages';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (new URL(c.url).origin === self.location.origin && 'focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
