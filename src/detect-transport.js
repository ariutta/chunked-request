import fetchRequest from './impl/fetch';
import mozXhrRequest from './impl/mozXhr';
import xhrRequest from './impl/xhr';

let selected = '';

export function detectOptimalTransport() {
  if (!selected) {
    if (typeof window.ReadableByteStream === 'function') {
      selected = fetchRequest;
    } else if (navigator.userAgent.toLowerCase().indexOf('firefox') !== -1) {
      selected = mozXhrRequest;
    } else {
      selected = xhrRequest;
    }
  }
  return selected;
}

