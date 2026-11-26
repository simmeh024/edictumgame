import { convert } from 'html-to-text';
import { createHash } from 'node:crypto';

const LIMIT = 1900; // Discord permits 2000 UTF-16 characters per message.

// Preserve all text, including long paragraphs, while staying below Discord's limit.
export function splitText(text, limit = LIMIT) {
  const parts = [];
  let part = '';
  for (const character of text) {
    if (part.length + character.length > limit) {
      parts.push(part);
      part = '';
    }
    part += character;
  }
  if (part) parts.push(part);
  return parts;
}

export function dispatchMessages(id, post) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid dispatch ID');
  const title = String(post.ti || 'Development dispatch').trim();
  const byline = typeof post.nm === 'string' && post.nm.trim()
    ? `\nBy ${post.nm.trim()}${post.rl ? ` — ${post.rl}` : ''}` : '';
  const body = convert(String(post.h || ''), {
    wordwrap: false,
    selectors: [{ selector: 'img', format: 'skip' }],
  }).trim();
  const poll = post.pl && typeof post.pl.q === 'string'
    ? '\n\nPoll: ' + post.pl.q + '\n' + (Array.isArray(post.pl.o) ? post.pl.o.map(x => '- ' + x).join('\n') : '')
    : '';
  const url = `https://edictumgame.com/#devnews/${encodeURIComponent(id)}`;
  return splitText(`${title}${byline}\n\n${body}${poll}\n\nRead in Edictum: ${url}`);
}

export function nonceFor(id, publicationTime, part) {
  return createHash('sha256').update(JSON.stringify([id, publicationTime, part])).digest('hex').slice(0, 24);
}

export function isPublication(before, after) {
  return !!after && after.pub === true && (!before || before.pub !== true);
}

export async function sendPart({ token, channelId, content, nonce, fetchImpl = fetch }) {
  if (!/^\d{15,22}$/.test(channelId)) throw new Error('Invalid Discord channel ID');
  const response = await fetchImpl(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, nonce, enforce_nonce: true, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}`);
  return response.json();
}
