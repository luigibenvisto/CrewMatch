/** An error whose message is safe to show to the person using the app. */
class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.isUserError = true;
  }
}

module.exports = { UserError };
