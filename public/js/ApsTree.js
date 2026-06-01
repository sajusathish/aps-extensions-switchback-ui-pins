// Responsible for the ACC hub/project/file tree on the left side.
// Do not put viewer rendering, issue table UI, or switchback JSON code here.

$(document).ready(function () {
  initialiseAuthState();

  $('#refreshBuckets').click(function () {
    var tree = $('#appBuckets').jstree(true);
    if (tree) tree.refresh();
  });
});

function initialiseAuthState() {
  $.get('/api/me')
    .done(function (me) {
      if (!me || !me.authenticated) {
        renderLoginPanel();
        return;
      }

      renderSignedInState(me);
      prepareAppBucketTree();
    })
    .fail(function () {
      renderLoginPanel();
    });
}

function renderLoginPanel() {
  $('#appBuckets').html(
    '<div class="auth-box">' +
      '<p>Sign in with Autodesk Forma Id to browse ACC hubs, projects, folders, and file versions.</p>' +
      '<a class="btn btn-primary btn-block" href="/auth/login">Login with Autodesk</a>' +
    '</div>'
  );

  $('#signedInUser').text('Not signed in');
}

function renderSignedInState(me) {
  var profile = me.profile || {};
  var displayName = profile.name || profile.firstName || profile.email || profile.userName || 'Signed in';
  $('#signedInUser').text(displayName);
  $('#authLinks').html('<a href="/auth/logout">Logout</a>');
}

function buildNodeData(node) {
  if (!node || node.id === '#') {
    return { id: '#' };
  }

  var data = node.data || {};

  return {
    id: node.id,
    type: node.type,
    hubId: data.hubId || (node.type === 'hub' ? node.id : undefined),
    projectId: data.projectId || (node.type === 'project' ? node.id : undefined),
    folderId: data.folderId || (node.type === 'folder' ? node.id : undefined),
    itemId: data.itemId || (node.type === 'item' ? node.id : undefined)
  };
}

function prepareAppBucketTree() {
  $('#appBuckets').jstree({
    core: {
      themes: { icons: true },
      multiple: false,
      data: {
        url: '/api/models/acc-tree',
        dataType: 'json',
        data: function (node) {
          return buildNodeData(node);
        },
        error: function (jqXHR) {
          var message = 'Could not load ACC tree.';
          try {
            var body = JSON.parse(jqXHR.responseText);
            message = body.error || body.details?.developerMessage || body.details || message;
          } catch (_) {}
          $('#appBuckets').html('<div class="alert alert-danger">' + message + '</div>');
        }
      }
    },
    types: {
      default: { icon: 'glyphicon glyphicon-question-sign' },
      '#': { icon: 'glyphicon glyphicon-cloud' },
      hub: { icon: 'glyphicon glyphicon-cloud' },
      project: { icon: 'glyphicon glyphicon-briefcase' },
      folder: { icon: 'glyphicon glyphicon-folder-open' },
      item: { icon: 'glyphicon glyphicon-file' },
      version: { icon: 'glyphicon glyphicon-eye-open' }
    },
    sort: function (a, b) {
      var nodeA = this.get_node(a);
      var nodeB = this.get_node(b);

      if (nodeA.type === 'version' && nodeB.type === 'version') {
        return Number(nodeB.data?.versionNumber || 0) - Number(nodeA.data?.versionNumber || 0);
      }

      return String(nodeA.text || '').localeCompare(String(nodeB.text || ''), undefined, { numeric: true });
    },
    plugins: ['types', 'sort', 'wholerow']
  })
    .on('activate_node.jstree', function (evt, data) {
      if (!data || !data.node) return;

      if (data.node.type === 'version') {
        loadVersionNode(data.node);
      } else if (data.node.type === 'item') {
        loadLatestItemVersion(data.node);
      }
    });
}

function loadVersionNode(node) {
  loadVersionData(node, node && node.text);
}

function loadVersionData(versionNode, fallbackName) {
  var data = versionNode.data || {};
  var urn = data.viewerUrn;
  var name = data.name || fallbackName || versionNode.text;

  if (!urn) {
    alert('This version does not expose a viewer URN. Open the file once in ACC, confirm it is viewable, and try again.');
    return;
  }

  var begin = document.getElementsByClassName('tobegin')[0];
  if (begin) begin.style.display = 'none';

  var modelInfo = {
    name: name,
    urn: urn,
    hubId: data.hubId || null,
    projectId: data.projectId || null,
    itemId: data.itemId || null,
    versionId: data.versionId || versionNode.id || null,
    versionNumber: data.versionNumber || null,
    treeText: versionNode.text,
    webViewUrl: data.webViewUrl || null
  };

  window.currentModelInfo = modelInfo;
  launchViewer(urn, name, modelInfo);
}

function loadLatestItemVersion(node) {
  var tree = $('#appBuckets').jstree(true);
  var requestData = buildNodeData(node);

  if (tree) {
    tree.set_text(node, node.text);
  }

  $.get('/api/models/acc-tree', requestData)
    .done(function (versions) {
      var latestVersion = Array.isArray(versions) ? versions[0] : null;

      if (!latestVersion) {
        alert('No viewable versions were found for this file.');
        return;
      }

      loadVersionData(latestVersion, node.text);
    })
    .fail(function () {
      alert('Could not load the latest version for this file.');
    });
}
