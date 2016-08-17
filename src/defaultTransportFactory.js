import defaultsDeep from 'lodash';
import fetchRequest from './impl/fetch';
import find from 'lodash';
import flow from 'lodash';
import keys from 'lodash';
//import textEncoding from 'text-encoding-utf-8';
import union from 'lodash';
import xhrRequest from './impl/baseXhr';

function noop(x) {return x;}

let selected = null;

//function decode(buf) {
//  return String.fromCharCode.apply(null, new Uint8Array(buf));
//}

function encode(str) {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i=0, strLen=str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
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
    if (typeof root.ReadableByteStream === 'function') {
      // browser supports fetch, so use it
      selected = fetchRequest;
    } else {
      // use XMLHttpRequest (XHR)

      const defaultListeners = {
        'progress': function() {
          const xhr = this;
          return xhr.response;
        }
      };

      let index;
      const xhrPatches = find([{
        // streaming, binary
        responseType: 'moz-chunked-arraybuffer',
        transport: 'MOZ_CHUNKED',
        on: defaultListeners
      }, {
        // streaming, binary
        responseType: 'ms-stream',
        transport: 'MS_STREAM',
        on: defaultListeners
      }, {
//        // e.g., Safari
//        // non-streaming, binary
//        responseType: 'arraybuffer',
//        toArrayBufferStream: function(options) {
//        },
//      }, {
        // supporting IE9 and webkit
        // See https://github.com/jonnyreeves/chunked-request/issues/13#issuecomment-239534227
        responseType: 'text',
        transport: 'XHR',
        on: {
          'readystatechange': function(readystate) {
            const xhr = this;
            // state 1 means OPENED
            if (readystate === 1) {
              console.log('opened');
              //XHR binary charset opt by Marcus Granado 2006
              //http://web.archive.org/web/20071103070418/http://mgran.blogspot.com/2006/08/downloading-binary-streams-with.html
              xhr.overrideMimeType('text/plain; charset=x-user-defined');
            }
          },
          'progress': function() {
            const xhr = this;
            const rawChunk = xhr.responseText.substr(index);
            index = xhr.responseText.length;
            return encode(rawChunk);
          }
        }
      }], function(candidate) {
        const xhr = new XMLHttpRequest();
        xhr.open('get', '/', true);
        const candidateResponseType = candidate.responseType;

        // We can only set the `responseType` after we've opened the connection or
        // FireFox will throw an error and according to the spec only async requests
        // can use this, which is fine as we force that by default.
        try {
          xhr.responseType = candidateResponseType;
          return xhr.hasOwnProperty('response') && (xhr.responseType === candidateResponseType);
        } catch (e) {
          return false;
        }
      });

      const {responseType, transport} = xhrPatches;

      const defaultOptions = {
        responseType: responseType
      };


      const patchListeners = xhrPatches.on;
      const listenersByEventName = union(keys(defaultListeners), keys(patchListeners))
      .reduce(function(acc, key) {
        const defaultListener = defaultListeners[key] || noop;
        const patchListener = patchListeners[key] || noop;
        acc[key] = flow(patchListener, defaultListener);
        return acc;
      }, {});

      selected = function(options) {
        if (!options) {
          throw new Error('No options specified');
        }
        defaultsDeep(options, defaultOptions);
        console.log('options');
        console.log(options);
        
        listenersByEventName.progress = flow(listenersByEventName.progress || noop, options.onRawChunk);

        listenersByEventName.loadend = flow(
            listenersByEventName.loadend || noop,
            function() {
              const xhr = this;
              return {
                statusCode: xhr.status,
                transport: transport,
                raw: xhr
              };
            },
            options.onRawComplete
        );

        listenersByEventName.error = flow(
            listenersByEventName.error || noop,
            function(err) {
              return {
                statusCode: 0,
                transport: transport,
                raw: err
              };
            },
            options.onRawComplete
        );

        xhrRequest(options, listenersByEventName);
      };
    }
  }
  return selected;
}
