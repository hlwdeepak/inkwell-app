// Heuristic pre-send check. This does NOT guarantee inbox placement — real
// spam filtering considers domain reputation, engagement history, and more
// than content alone — but it catches the content-level mistakes that
// commonly tip a borderline-reputation email into the spam folder.

const TRIGGER_PHRASES = [
  'free money', 'act now', 'click here', 'buy now', 'order now', 'risk-free',
  'no obligation', 'guaranteed', 'winner', "you've been selected", 'congratulations',
  'limited time', 'once in a lifetime', 'cash bonus', 'earn extra cash',
  'work from home', 'lowest price', 'no credit check', 'call now', '100% free',
  'apply now', 'urgent', 'act immediately', 'dear friend',
];

const URL_SHORTENERS = ['bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd'];

function check(subject = '', body = '') {
  const warnings = [];
  const full = `${subject}\n${body}`;
  const lowerFull = full.toLowerCase();

  // Trigger phrases
  const hits = TRIGGER_PHRASES.filter((p) => lowerFull.includes(p));
  if (hits.length) {
    warnings.push({
      type: 'trigger_phrases',
      severity: hits.length >= 3 ? 'high' : 'medium',
      message: `Contains spam-associated phrase(s): ${hits.join(', ')}`,
    });
  }

  // ALL CAPS subject (ignoring short acronyms)
  const subjectWords = subject.split(/\s+/).filter((w) => w.length > 2);
  const capsWords = subjectWords.filter((w) => w === w.toUpperCase() && /[A-Z]/.test(w));
  if (subjectWords.length > 0 && capsWords.length / subjectWords.length > 0.5) {
    warnings.push({ type: 'caps_subject', severity: 'high', message: 'Subject line is mostly ALL CAPS' });
  }

  // Excessive exclamation points
  const bangCount = (full.match(/!/g) || []).length;
  if (bangCount >= 3) {
    warnings.push({ type: 'exclamations', severity: 'medium', message: `${bangCount} exclamation marks — consider trimming to 0–1` });
  }

  // Excessive $ or price-shouting patterns
  if (/\$\$+|!!+|FREE!!+/i.test(full)) {
    warnings.push({ type: 'shouting_punctuation', severity: 'medium', message: 'Repeated punctuation (e.g. "$$$", "!!!") reads as spammy' });
  }

  // URL shorteners
  const shortenerHit = URL_SHORTENERS.find((s) => lowerFull.includes(s));
  if (shortenerHit) {
    warnings.push({ type: 'url_shortener', severity: 'high', message: `Contains a link shortener (${shortenerHit}) — these are frequently blocklisted` });
  }

  // Link count
  const urlMatches = full.match(/https?:\/\/[^\s)]+/g) || [];
  if (urlMatches.length > 5) {
    warnings.push({ type: 'link_count', severity: 'medium', message: `${urlMatches.length} links in this email — walls of links look spammy, aim for fewer` });
  }

  // No personalization
  if (!body.includes('{{first_name}}')) {
    warnings.push({ type: 'no_personalization', severity: 'low', message: 'No {{first_name}} personalization — personalized emails tend to perform and deliver better' });
  }

  // Empty or very short body
  if (body.trim().length < 40) {
    warnings.push({ type: 'thin_content', severity: 'medium', message: 'Body is very short — thin content is a weak spam signal on its own' });
  }

  const score = warnings.reduce((sum, w) => sum + (w.severity === 'high' ? 3 : w.severity === 'medium' ? 2 : 1), 0);
  const risk = score >= 6 ? 'high' : score >= 3 ? 'medium' : score > 0 ? 'low' : 'clean';

  return { risk, score, warnings };
}

module.exports = { check };
