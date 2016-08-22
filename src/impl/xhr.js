const EventEmitter = require('eventemitter3');

export default function xhrRequest(options) {
  const ee = new EventEmitter();

  const textEncoder = new TextEncoder();
  const xhr = new XMLHttpRequest();
  let index = 0;

  return new Promise(function(resolveFetchPromise, rejectFetchPromise) {
    let queuedRawTextChunks = [];
    let loaded = false;

    function getReaderResult(done) {
      // we can't determine done from
      // const done = (xhr.readyState === 4);
      // here, because xhr.readyState is 4 as
      // soon as the last progress event occurs.
      return {
        value: textEncoder.encode(queuedRawTextChunks.splice(0).join(), {stream: !done}),
        done: done
      };
    }

    function getReaderPromise() {
      return new Promise(function(resolveReaderPromise, rejectReaderPromise) {
        // immediate responses
        if (queuedRawTextChunks.length > 0) {
          return resolveReaderPromise(getReaderResult(false));
        } else if (loaded) {
          return resolveReaderPromise(getReaderResult(true));
        }

        // async responses
        const onData = function() {
          ee.removeListener('data', onData);
          ee.removeListener('end', onEnd);
          resolveReaderPromise(getReaderResult(false));
        };
        const onEnd = function() {
          ee.removeListener('data', onData);
          ee.removeListener('end', onEnd);
          resolveReaderPromise(getReaderResult(true));
        };
        ee.on('data', onData);
        ee.on('end', onEnd);
      });
    }

    function onReadyStateChange() {
      if (xhr.readyState === xhr.HEADERS_RECEIVED) {
        const readableStream = {
          headers: {
            get: function(header) {
              return xhr.getResponseHeader(header);
            }
          },
          body: {
            getReader: function() {
              return {
                read: getReaderPromise
              }
            }
          }
        };
        resolveFetchPromise(readableStream);
      }
    }

    function onProgress() {
      const rawText = xhr.responseText.substr(index);
      index = xhr.responseText.length;
      queuedRawTextChunks.push(rawText);
      // NOTE need to use ee, because we can't add listeners to
      // xhr once we call open.
      ee.emit('data', true);
    }

    function onLoad() {
      loaded = true;
      // NOTE need to use ee, because we can't add listeners to
      // xhr once we call open.
      ee.emit('end', true);
    }

    const onError = rejectFetchPromise;

    function onLoadEnd() {
      xhr.removeEventListener('progress', onProgress);
      xhr.removeEventListener('load', onLoad);
      ee.removeListener('data');
      xhr.removeEventListener('error', onError);
      xhr.removeEventListener('loadend', onLoadEnd);
    }

    xhr.open(options.method, options.url);
    xhr.responseType = 'text';
    if (options.headers) {
      Object.getOwnPropertyNames(options.headers).forEach(k => {
        xhr.setRequestHeader(k, options.headers[k]);
      })
    }
    if (options.credentials === 'include') {
      xhr.withCredentials = true;
    }
    xhr.addEventListener('readystatechange', onReadyStateChange);
    xhr.addEventListener('progress', onProgress);
    // TODO some browsers historically have not fired onprogress
    // for the last chunk, but they should. Are
    // there any we need to worry about?
    xhr.addEventListener('load', onLoad);
    xhr.addEventListener('error', onError);
    xhr.addEventListener('loadend', onLoadEnd);
    xhr.send(options.body);
  });
}
