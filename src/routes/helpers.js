const { UserError } = require('../lib/errors');
const { validate, schemas } = require('../lib/validation');

function setFlash(req, text, type = 'success') {
  req.session.flash = { text, type };
}

function requireAccount(type, loginPath) {
  return (req, res, next) => {
    const account = req.session.account;
    if (account && account.type === type) {
      req.accountId = account.id;
      return next();
    }
    if (account) {
      // Logged in, but as the other kind of account. Data never crosses over.
      return res.status(403).render('error', {
        title: 'Wrong account type',
        message: `You are logged in as ${account.type === 'crew' ? 'crew' : account.type === 'admin' ? 'admin' : 'a production'}. Log out first to use this part of CrewMatch.`,
      });
    }
    return res.redirect(loginPath);
  };
}

/** Logs in by replacing the whole session, so an old session id can never be reused. */
function startSession(req, account) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.account = account;
      return req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

function paramId(req, name = 'id') {
  const { data, errors } = validate(schemas.id, req.params[name]);
  if (errors) throw new UserError('Not found.', 404);
  return data;
}

/** Runs an action that may throw a UserError; shows the message as a flash and redirects back. */
async function actionThenRedirect(req, res, to, fn) {
  try {
    const message = await fn();
    if (message) setFlash(req, message);
  } catch (err) {
    if (!err.isUserError) throw err;
    setFlash(req, err.message, 'error');
  }
  res.redirect(to);
}

module.exports = { setFlash, requireAccount, startSession, paramId, actionThenRedirect };
