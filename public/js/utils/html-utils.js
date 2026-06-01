// Shared HTML and DOM helpers. Use these when building small HTML strings safely.
(function () {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
  }

  function setElementText(id, value, fallback) {
    var element = document.getElementById(id);
    var textHelper = window.TextUtils?.text || function (input) { return String(input || ''); };

    if (element) element.textContent = textHelper(value, fallback);
  }

  window.HtmlUtils = {
    escapeHtml: escapeHtml,
    escapeAttribute: escapeAttribute,
    setElementText: setElementText
  };
})();
