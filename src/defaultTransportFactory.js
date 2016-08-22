import defaultsDeep from 'lodash/defaultsdeep';
import fetchRequest from './impl/fetch';
import find from 'lodash/find';
import flow from 'lodash/flow';
import keys from 'lodash/keys';
import { noop } from './util';
import textEncoding from 'text-encoding-utf-8'; // only needed for IE9
import union from 'lodash/union';
import xhrRequest from './impl/xhr';

let selected = null;
let textEncoder;
if (typeof TextEncoder !== 'undefined') {
  textEncoder = new TextEncoder();
} else if (typeof Uint8Array !== 'undefined') {
  textEncoder = {
    encode: function(str) {
      const buf = new ArrayBuffer(str.length);
      const bufView = new Uint8Array(buf);
      for (let i=0, strLen=str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
      }
      return buf;
    }
  };
} else {
  // only for IE9
  textEncoder = textEncoding;
}

/**
 * defaultTransportFactory
 *
 * Current types:
 * - fetch (streaming, binary)
 * - XMLHttpRequest (XHR)
 *   streaming vs. cumulative
 *   binary vs. non
 *
 * Types we will check for:
 * 'moz-chunked-arraybuffer': binary streaming
 * 'ms-stream': binary streaming
 * 'arraybuffer': binary cumulative
 * 'text': text cumulative
 *
 * I think it's safe to ignore these responseTypes:
 *   'blob': binary streaming
 *   'moz-blob': binary streaming
 *   'moz-chunked-text': text streaming
 * because I'm not aware of any browsers that have one of them but do not
 * also have one of the above binary streaming responseType options.
 *
 * @param {Object} root "window", "self" or "this", depending on environment
 * @returns {Function} an implementation for making the request. The implementation
 *                     must return a streaming arraybuffer.
 */
export default function defaultTransportFactory(root) {
  if (!selected) {
    if (typeof root.fetch === 'function' && typeof root.ReadableStream === 'function') {
      // browser supports ReadableStream and fetch, so use native fetch
      // TODO should we run a try/catch to make sure we do get back a WHATWG stream?
      selected = fetchRequest;
    } else {
      // use XMLHttpRequest (XHR)
      const binaryStreamListeners = {
        'progress': function() {
          const xhr = this;
          return xhr.response;
        }
      };

      let index;
      const xhrPatches = find([{
        // streaming, binary
        responseType: 'stream',
        transport: 'stream',
        on: binaryStreamListeners
      }, {
        // streaming, binary
        responseType: 'moz-chunked-arraybuffer',
        transport: 'moz-chunked',
        on: binaryStreamListeners
      }, {

        // streaming, binary
        responseType: 'ms-stream',
        transport: 'ms-stream',
        // NOTE: listeners specified later when we get options from user
        on: {}
      }, {
//        // TODO should we enable this option or just use text for e.g., Safari?
//        // Note that Safari will support fetch soon.
//        // non-streaming, binary
//        responseType: 'arraybuffer',
//        'progress': function() {
//          const xhr = this;
//          const encoded = xhr.response.slice(index);
//          index = xhr.response.length;
//          return encoded;
//        }
//      }, {
        // streaming, non-binary
        // For IE9 and webkit
        // See https://github.com/jonnyreeves/chunked-request/issues/13#issuecomment-239534227
        responseType: 'text',
        transport: 'xhr',
        on: {
          'readystatechange': function() {
            const xhr = this;
            if (!xhr.mimeTypeOverriden) {
              //XHR binary charset opt by Marcus Granado 2006
              //http://web.archive.org/web/20071103070418/http://mgran.blogspot.com/2006/08/downloading-binary-streams-with.html
              xhr.overrideMimeType('text/plain; charset=x-user-defined');
              xhr.mimeTypeOverriden = true;
            }
          },
          'progress': function() {
            const xhr = this;
            const rawChunk = xhr.responseText.substr(index);
            index = xhr.responseText.length;
            const encoded = textEncoder.encode(rawChunk, {stream: true});
            return encoded;
          }
        }
      }], function(candidate) {
        // test inspired by https://github.com/unshiftio/requests/blob/master/browser.js
        const xhr = new XMLHttpRequest();
        xhr.open('get', '/', true);
        const candidateResponseType = candidate.responseType;

        // We can only set the `responseType` after we've opened the connection or
        // FireFox will throw an error and according to the spec only async requests
        // can use this, which is fine as we force that by default.
        try {
          xhr.responseType = candidateResponseType;
          return (typeof xhr.response !== 'undefined' || typeof xhr.responseText !== 'undefined') && (xhr.responseType === candidateResponseType);
        } catch (e) {
//          // TODO should we show this?
//          // The testing for a compatible responseType may show warnings in the dev console
//          // (at least Chrome does) when trying non-supported responseTypes.
//          const message = [
//            'Console warnings may be expected.',
//            'Library "chunked-request" is trying to find a supported responseType.',
//            'https://github.com/jonnyreeves/chunked-request'
//          ].join(' ');
//          console.log(message);
          return false;
        }
      });

      const {responseType, transport} = xhrPatches;

      const defaultOptions = {
        responseType: responseType
      };

      const patchListeners = xhrPatches.on;

      selected = function(options) {
        if (!options) {
          throw new Error('No options specified');
        }

        let parserListeners;
        if (responseType !== 'ms-stream') {
          parserListeners = {
            progress: options.onRawChunk,
            loadend: function() {
              const xhr = this;
              options.onRawChunk(null, true);
              return options.onRawComplete({
                statusCode: xhr.status,
                transport: transport,
                raw: xhr
              });
            },
            error: function(err) {
              return options.onRawComplete({
                statusCode: 0,
                transport: transport,
                raw: err
              });
            }
          };
        } else if (responseType === 'ms-stream') {
          // TODO The following is a quick start at trying it out,
          // but we need to research ms-stream and readAsArrayBuffer more:
          // https://msdn.microsoft.com/en-us/library/hh772312(v=vs.85).aspx
          // https://msdn.microsoft.com/en-us/library/hh772330(v=vs.85).aspx
          // https://msdn.microsoft.com/en-us/library/hh772328(v=vs.85).aspx
          parserListeners = {
            readystatechange: function() {
              const xhr = this;
              if (xhr.readyState === 3 && xhr.status === 200 ) {
                const msstream = xhr.response; // MSStream object
                const stream = msstream.msDetachStream(); // IInputStreamObject

                // from https://msdn.microsoft.com/en-us/library/hh772330(v=vs.85).aspx
                const reader = new MSStreamReader();

                // Set up callbacks to handle progress, success, and errors:
                reader.onprogress = function(e) {
                  // TODO I don't know whether this has the chunked result
                  // because the example MS gave for getting the result
                  // was only for the "onload" event
                  options.onRawChunk(e.target.result)
                };
                reader.onload = function() {
                  options.onRawChunk(null, true);
                  return options.onRawComplete({
                    statusCode: xhr.status,
                    transport: transport,
                    raw: xhr
                  });
                };
                reader.onerror = function(err) {
                  return options.onRawComplete({
                    statusCode: 0,
                    transport: transport,
                    raw: err
                  });
                };

                // Read file into memory:
                reader.readAsArrayBuffer(stream);
              }
            }
          };
        }

        const listenersByEventName = union(keys(patchListeners), keys(parserListeners))
        .reduce(function(acc, key) {
          const patchListener = patchListeners[key] || noop;
          const parserListener = parserListeners[key] || noop;
          acc[key] = flow(patchListener, parserListener);
          return acc;
        }, {});

        defaultsDeep(options, defaultOptions);
        xhrRequest(options, listenersByEventName, root);
      };
    }
  }
  return selected;
}
