/* Google Drive sync for Recipe Vault.
   Uses Google Identity Services (token flow) and the Drive REST API directly.
   The whole library is one JSON file ("recipe-vault.json") that both accounts can open. */
(function (root) {
  'use strict';

  var FILE_NAME = 'recipe-vault.json';
  var SCOPE = 'https://www.googleapis.com/auth/drive';
  var token = null;
  var tokenExp = 0;
  var tokenClient = null;
  var gisPromise = null;

  function loadGIS() {
    if (root.google && root.google.accounts && root.google.accounts.oauth2) return Promise.resolve();
    if (gisPromise) return gisPromise;
    gisPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { gisPromise = null; reject(new Error('Could not load Google sign-in. Check your connection.')); };
      document.head.appendChild(s);
    });
    return gisPromise;
  }

  function signIn(clientId, interactive) {
    return loadGIS().then(function () {
      return new Promise(function (resolve, reject) {
        tokenClient = root.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: function (resp) {
            if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
            token = resp.access_token;
            tokenExp = Date.now() + (parseInt(resp.expires_in, 10) || 3600) * 1000 - 60000;
            resolve(token);
          },
          error_callback: function (err) { reject(new Error((err && (err.message || err.type)) || 'Sign-in cancelled')); }
        });
        tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
      });
    });
  }

  function hasToken() { return !!token && Date.now() < tokenExp; }

  function api(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {});
    return fetch(url, opts).then(function (r) {
      if (r.status === 401) { token = null; throw new Error('Google sign-in expired. Tap Connect again.'); }
      if (!r.ok) return r.text().then(function (t) { throw new Error('Drive error ' + r.status + ': ' + t.slice(0, 160)); });
      return r;
    });
  }

  function findFile() {
    var q = encodeURIComponent("name='" + FILE_NAME + "' and trashed=false");
    var url = 'https://www.googleapis.com/drive/v3/files?q=' + q + '&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime)&pageSize=10';
    return api(url).then(function (r) { return r.json(); }).then(function (j) { return (j.files && j.files[0]) || null; });
  }

  function download(id) {
    return api('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media').then(function (r) { return r.json(); });
  }

  function create(obj) {
    var boundary = 'rvboundary' + Date.now();
    var meta = JSON.stringify({ name: FILE_NAME, mimeType: 'application/json' });
    var body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n' +
      '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(obj) + '\r\n--' + boundary + '--';
    return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: body
    }).then(function (r) { return r.json(); });
  }

  function update(id, obj) {
    return api('https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj)
    });
  }

  /* local: snapshot of the app state. merge(local, remote) -> merged state.
     Returns a promise of the merged state (already uploaded). */
  function sync(local, merge) {
    if (!hasToken()) return Promise.reject(new Error('Not signed in to Google'));
    return findFile().then(function (file) {
      if (!file) {
        return create(local).then(function () { return local; });
      }
      return download(file.id).then(function (remote) {
        var merged = merge(local, remote || {});
        return update(file.id, merged).then(function () { return merged; });
      });
    });
  }

  function signOut() {
    if (token && root.google && root.google.accounts && root.google.accounts.oauth2) {
      try { root.google.accounts.oauth2.revoke(token, function () {}); } catch (e) { /* ignore */ }
    }
    token = null; tokenExp = 0;
  }

  root.Drive = { signIn: signIn, signOut: signOut, hasToken: hasToken, sync: sync, FILE_NAME: FILE_NAME };
})(window);
