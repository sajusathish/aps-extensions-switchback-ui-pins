// Shared date formatting helpers. Keep issue-specific date field lookup outside this file.
(function () {
  function fallbackText(value) {
    return window.TextUtils?.text
      ? window.TextUtils.text(value, '-')
      : String(value || '-');
  }

  function formatDate(value) {
    if (!value) return '-';

    var date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return fallbackText(value);
    }

    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatIssueDate(value) {
    if (!value) return '-';

    var date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return fallbackText(value);
    }

    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    });
  }

  function toDateInputValue(value) {
    if (!value) return '';

    var date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : '';
    }

    return date.toISOString().slice(0, 10);
  }

  function formatRelativeTime(value) {
    if (!value) return '';

    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return formatDate(value);

    var seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return 'Moments ago';

    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + ' min ago';

    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' hr ago';

    var days = Math.floor(hours / 24);
    if (days < 7) return days + ' day' + (days === 1 ? '' : 's') + ' ago';

    return formatDate(value);
  }

  window.DateUtils = {
    formatDate: formatDate,
    formatIssueDate: formatIssueDate,
    toDateInputValue: toDateInputValue,
    formatRelativeTime: formatRelativeTime
  };
})();
