//import ee from 'event-emitter';
import toPairs from 'lodash';

export default function xhrRequest(options, listenersByEventName) {
  //const emitter = new ee();

  const xhr = new XMLHttpRequest();

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
