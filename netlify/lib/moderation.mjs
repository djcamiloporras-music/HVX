/* CVMILOPORRAS_SERVER */
/* Comment moderation for the HVX feed. Lives outside netlify/functions so
   it is bundled as a library, never deployed as an endpoint of its own.

   review(text) -> { verdict, reason }
     'clean'    publish immediately
     'review'   hold for a human, do not publish
     'reject'   refuse outright and tell the author why

   WHAT THIS IS AND IS NOT
   A word list is a speed bump, not a wall. "p*ta", "pu ta" and "b!tch" all
   walk straight past a naive match, so every comment is normalised first:
   accents dropped, digits and symbols mapped back to letters, runs of the
   same letter collapsed, separators between letters removed. That catches
   the lazy attempts, which is most of them.

   It will still miss things, and it will still flag innocent text. That is
   why the middle verdict exists: anything uncertain waits for a person
   instead of being published or destroyed. Nothing here removes the need
   for the delete button in the admin panel.

   Adding a hosted moderation model later means editing only this file:
   nothing else knows how the verdict was reached. */

const MAX_LENGTH = 1200;
const MIN_LENGTH = 2;
const MAX_LINKS = 2;

/* Deliberately short. A long list is not a better list, it is more false
   positives. These are the words worth acting on unattended; anything
   subtler is what the review queue is for. Edit freely. */
const REJECT = [
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'bastard', 'whore',
  'puta', 'puto', 'mierda', 'cabron', 'gilipollas', 'pendejo',
  'verga', 'chinga', 'maricon', 'malparido', 'hijueputa', 'culero',
  'nigger', 'faggot', 'retard', 'tranny',
];

/* Not offensive on their own, but the vocabulary of spam. Held, not killed. */
const REVIEW = [
  'viagra', 'casino', 'crypto giveaway', 'free money', 'click here',
  'work from home', 'telegram me', 'whatsapp me', 'dm me for', 'promo code',
  'cheap followers', 'buy followers',
];

/* Strip everything an author might hide behind, then compare what is left. */
function normalise(text) {
  let s = String(text || '').toLowerCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');   /* accents */
  s = s
    .replace(/[0@]/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e')
    .replace(/4/g, 'a').replace(/[5$]/g, 's').replace(/7/g, 't')
    .replace(/8/g, 'b').replace(/\+/g, 't');
  s = s.replace(/[^a-z\s]/g, '');            /* punctuation used as a spacer */
  s = s.replace(/(.)\1{2,}/g, '$1');         /* fuuuuck -> fuck */
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/* "f u c k" and "f-u-c-k" both collapse to the same run of letters. */
function despaced(normalised) {
  return normalised.replace(/\s/g, '');
}

function hit(list, normalised, joined) {
  return list.find((word) => {
    const w = normalise(word);
    if (!w) return false;
    if (w.includes(' ')) return normalised.includes(w);
    const bounded = new RegExp('(^|\\s)' + w + '(\\s|$)');
    return bounded.test(normalised) || joined.includes(w);
  }) || null;
}

/* A symbol standing in for a letter, as in p*ta or sh_t. Stripping the
   symbol leaves "pta", which matches nothing, so the word is compared
   position by position instead: same length, one character different, and
   that character is not a letter.

   This returns a word to hold for review rather than to reject. Allowing a
   wildcard anywhere also matches innocent words - p.ta is one edit from
   both "puta" and "pita" - and refusing a comment about bread is worse
   than asking a person to glance at it. */
function censored(text) {
  const t = String(text || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const tokens = t.split(/\s+/)
    .map((tok) => tok.replace(/^[^a-z0-9*_.@#$-]+|[^a-z0-9*_.@#$-]+$/g, ''))
    .filter(Boolean);

  for (const tok of tokens) {
    for (const word of REJECT) {
      if (tok.length !== word.length) continue;
      let diff = 0;
      let masked = false;
      for (let i = 0; i < word.length; i++) {
        if (tok[i] !== word[i]) {
          diff += 1;
          if (!/[a-z]/.test(tok[i])) masked = true;
        }
      }
      if (diff === 1 && masked) return word;
    }
  }
  return null;
}

export function review(text) {
  const raw = String(text || '').trim();

  if (raw.length < MIN_LENGTH) {
    return { verdict: 'reject', reason: 'Write something first.' };
  }
  if (raw.length > MAX_LENGTH) {
    return { verdict: 'reject', reason: 'Keep it under ' + MAX_LENGTH + ' characters.' };
  }

  const norm = normalise(raw);
  const joined = despaced(norm);

  if (hit(REJECT, norm, joined)) {
    return { verdict: 'reject', reason: 'That language is not welcome here.' };
  }

  const links = (raw.match(/https?:\/\/|www\.|\.com|\.net|\.org/gi) || []).length;
  if (links > MAX_LINKS) return { verdict: 'review', reason: 'many links' };

  if (censored(raw)) return { verdict: 'review', reason: 'possible masked profanity' };

  const spam = hit(REVIEW, norm, joined);
  if (spam) return { verdict: 'review', reason: 'possible spam: ' + spam };

  /* Shouting, but only once there is enough text for it to be deliberate. */
  const letters = raw.replace(/[^A-Za-z]/g, '');
  if (letters.length > 24) {
    const caps = raw.replace(/[^A-Z]/g, '').length;
    if (caps / letters.length > 0.75) return { verdict: 'review', reason: 'all caps' };
  }

  /* One word repeated is not a comment. */
  const words = norm.split(' ').filter(Boolean);
  if (words.length > 5 && new Set(words).size <= 2) {
    return { verdict: 'review', reason: 'repetition' };
  }

  return { verdict: 'clean', reason: '' };
}

export const LIMITS = { MAX_LENGTH, MIN_LENGTH };
