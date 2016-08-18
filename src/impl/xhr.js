import toPairs from 'lodash/topairs';

/**
 * Completely destroy the running XHR and release of the internal references.
 * from https://github.com/unshiftio/requests/blob/master/browser.js
 *
 * @returns {Boolean} Successful destruction
 * @api public
 */
function destroy(xhr) {
  if (!xhr.socket) {
    return false;
  }

  xhr.socket.abort();
  xhr.removeAllListeners();

  xhr.headers = {};
  xhr.socket = null;
  xhr.body = null;

  return true;
}

export default function xhrRequest(options, listenersByEventName, root) {

  const xhr = new XMLHttpRequest();

  // IE has a bug which causes IE10 to freeze when close WebPage during an XHR
  // request: https://support.microsoft.com/kb/2856746
  //
  // The solution is to completely clean up all active running requests.
  // from https://github.com/unshiftio/requests/blob/master/browser.js
  if (root.attachEvent) {
    root.attachEvent('onunload', function() {
      destroy(xhr);
    });
  }

  xhr.open(options.method, options.url);
  xhr.responseType = options.responseType;
  if (options.headers) {
    Object.getOwnPropertyNames(options.headers).forEach(k => {
      xhr.setRequestHeader(k, options.headers[k]);
    })
  }
  if (options.credentials === 'include') {
    xhr.withCredentials = true;
  }

  toPairs(listenersByEventName)
  .forEach(function(result) {
    const eventName = result[0];
    const listener = result[1];
    xhr.addEventListener(eventName, listener);
  })
  xhr.send(options.body);

  return xhr;
}
