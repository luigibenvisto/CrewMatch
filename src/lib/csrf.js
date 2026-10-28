/**
 * Protection against cross-site request forgery: every form carries a secret
 * token tied to the visitor's session, and every POST must send it back.
 */
const crypto = require('crypto');

function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;

  if (req.method !== 'POST') return next();
  const sent = Buffer.from(String((req.body && req.body._csrf) || ''));
  const expected = Buffer.from(req.session.csrfToken);
  if (sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) {
    return res.status(403).render('error', { title: 'Form expired', message: 'This form expired. Go back, reload the page and try again.' });
  }
  return next();
}

module.exports = { csrfProtection };
