// Shared text helpers used by the UI files. Keep feature-specific issue logic out of this file.
(function () {
  function isRawAutodeskId(value) {
    if (!value || typeof value !== 'string') return false;

    var trimmed = value.trim();

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return true;
    if (/^[0-9a-f]{24}$/i.test(trimmed)) return true;
    if (/^[0-9]{5,}$/.test(trimmed)) return true;
    if (/^[A-Z0-9]{12,24}$/i.test(trimmed) && !trimmed.includes('@') && !trimmed.includes(' ')) return true;
    if (trimmed.startsWith('urn:')) return true;
    if (trimmed.startsWith('b.')) return true;

    return false;
  }

  function getDisplayName(value, fallback) {
    if (!value) return fallback || '-';

    if (typeof value === 'string') {
      return isRawAutodeskId(value) ? (fallback || 'Unresolved name') : value;
    }

    if (typeof value !== 'object') {
      return String(value);
    }

    var name =
      value.name ||
      value.displayName ||
      value.fullName ||
      [value.firstName, value.lastName].filter(Boolean).join(' ') ||
      value.email ||
      value.title ||
      value.label ||
      value.companyName ||
      value.roleName ||
      value.attributes?.name ||
      value.attributes?.displayName ||
      [value.attributes?.firstName, value.attributes?.lastName].filter(Boolean).join(' ') ||
      value.attributes?.email ||
      value.attributes?.title ||
      value.user?.name ||
      value.user?.displayName ||
      [value.user?.firstName, value.user?.lastName].filter(Boolean).join(' ') ||
      value.user?.email ||
      value.company?.name ||
      value.company?.displayName ||
      value.role?.name ||
      value.role?.displayName ||
      null;

    if (name) return String(name);

    return fallback || '-';
  }

  function text(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback || '-';

    if (typeof value === 'object') {
      return getDisplayName(value, fallback || '-');
    }

    var stringValue = String(value);

    if (isRawAutodeskId(stringValue)) {
      return fallback || 'Unresolved name';
    }

    return stringValue;
  }

  function normalise(value) {
    return String(value || '').trim().toLowerCase();
  }

  function uniqueValues(values) {
    var set = new Set();

    values.forEach(function (value) {
      var clean = text(value, '').trim();
      if (clean && clean !== '-' && !isRawAutodeskId(clean)) {
        set.add(clean);
      }
    });

    return Array.from(set).sort(function (a, b) {
      return a.localeCompare(b);
    });
  }

  function getInitials(value, fallback) {
    var words = String(value || '').trim().split(/\s+/).filter(Boolean);

    if (words.length >= 2) {
      return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
    }

    return String(words[0] || fallback || '?').slice(0, 2).toUpperCase();
  }

  function stripProjectPrefix(value) {
    var textValue = String(value || '');
    return textValue.startsWith('b.') ? textValue.substring(2) : textValue;
  }

  function cleanRoleName(name) {
    return String(name || '').replace(/^\d+\s+/, '').replace(/\s+\(role\)$/i, '').trim();
  }

  function cleanAssigneeName(name, type) {
    if (String(type || '').toLowerCase() === 'role') {
      return cleanRoleName(name);
    }

    return String(name || '').trim();
  }

  window.TextUtils = {
    isRawAutodeskId: isRawAutodeskId,
    getDisplayName: getDisplayName,
    text: text,
    normalise: normalise,
    uniqueValues: uniqueValues,
    getInitials: getInitials,
    stripProjectPrefix: stripProjectPrefix,
    cleanRoleName: cleanRoleName,
    cleanAssigneeName: cleanAssigneeName
  };
})();
