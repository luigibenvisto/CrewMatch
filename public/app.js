// Small progressive enhancements. The site works without JavaScript.
document.addEventListener('submit', function (event) {
  var form = event.target;
  var question = form.getAttribute('data-confirm');
  if (question && !window.confirm(question)) event.preventDefault();
});
document.addEventListener('click', function (event) {
  var link = event.target.closest('[data-back]');
  if (link && window.history.length > 1) {
    event.preventDefault();
    window.history.back();
  }
});
