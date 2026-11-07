/* Pacing for the callables, before they read anything: a token bucket per key (a player, an IP address), kept in the
   instance's memory. Each instance keeps its own, so a caller spread over N instances gets at most N times the rate:
   it is the cheap first line against one script flooding a callable (every save permit, Assembly action and account
   step costs reads and writes), not an exact quota. A player playing normally never meets it: the rules let a
   nation save at most once a second, and the game polls far slower than these rates. */
import { HttpsError } from 'firebase-functions/v2/https';

const MAX_KEYS = 50000, buckets = new Map();

/* one token from bucket `key` (at most `burst`, refilled at `perSec` a second): false when it is empty */
export function take(key, burst, perSec, now = Date.now()) {
  let b = buckets.get(key);
  if (b) {
    b.t = Math.min(burst, b.t + Math.max(0, now - b.at) / 1000 * perSec); b.at = now;
    buckets.delete(key);   // to the back: the map stays in order of use, and the least used go first when full
  } else {
    if (buckets.size >= MAX_KEYS) buckets.delete(buckets.keys().next().value);
    b = { t: burst, at: now };
  }
  buckets.set(key, b);
  if (b.t < 1) return false;
  b.t -= 1;
  return true;
}

/* rules: [[key, burst, perSec], ...], every one of which must have a token */
export function pace(rules, message = 'Too many requests at once. Wait a moment and try again.') {
  for (const [key, burst, perSec] of rules) if (!take(key, burst, perSec)) throw new HttpsError('resource-exhausted', message, { code: 'paced' });
}

/* the caller's address, as the callable sees it */
export const ipOf = req => String(req.rawRequest?.ip || 'unknown');
/* a rule for the caller's address: none in the emulators, where every test player calls from the same one */
export const ipRule = (req, name, burst, perSec) => process.env.FUNCTIONS_EMULATOR === 'true' ? [] : [[name + ':' + ipOf(req), burst, perSec]];

/* for the tests */
export const resetPace = () => buckets.clear();
