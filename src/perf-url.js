/* The address Firebase Performance Monitoring reports for a download (build.py, PERF_EDITS), so that none carries a
   player ID. The site's own addresses and Firebase's (googleapis.com, Cloud Functions, Cloud Run) keep their path,
   with anything that looks like an ID as *: a run of 16 or more letters and digits with a digit in it, or of 24 or
   more (a player ID has 28), so nations/<uid> becomes nations/*. Any other site keeps only its host: a picture's
   path there can name a person (an avatar). Never a query or a #hash. */
self.edictumPerfUrl = function (u) {
  var x;
  try { x = new URL(String(u), location.href); } catch (e) { return ''; }
  if (x.protocol !== 'https:' && x.protocol !== 'http:') return x.protocol;
  var ours = x.origin === location.origin || /(^|\.)(googleapis\.com|cloudfunctions\.net|run\.app)$/.test(x.hostname);
  if (!ours) return x.origin + '/';
  return x.origin + x.pathname.replace(/[A-Za-z0-9]{16,}/g, function (t) { return t.length >= 24 || /\d/.test(t) ? '*' : t; });
};
