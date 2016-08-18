const entryDelimiter = '\n';
import textEncoding from 'text-encoding-utf-8';

let textDecoder;
if (typeof TextDecoder !== 'undefined') {
  textDecoder = new TextDecoder();
} else if (typeof Uint8Array !== 'undefined') {
  textDecoder = {
    decode: function(buf) {
      return String.fromCharCode.apply(null, new Uint8Array(buf));
    }
  };
} else {
  textDecoder = textEncoding;
}

// The defaultChunkParser expects the response from the server to consist of new-line
// delimited JSON, eg:
//
//  { "chunk": "#1", "data": "Hello" }
//  { "chunk": "#2", "data": "World" }
//
// It will correctly handle the case where a chunk is emitted by the server across
// delimiter boundaries.
export default function defaultChunkParser(rawChunk, prevTextChunkSuffix = '', isFinalChunk = false) {
  let textChunkSuffix;
  let rawTextChunk;
  if (rawChunk) {
    rawTextChunk = textDecoder.decode(rawChunk, {stream: !isFinalChunk});
  } else {
    rawTextChunk = '';
  }
  const rawTextChunks = `${prevTextChunkSuffix}${rawTextChunk}`
    .split(entryDelimiter);

  if (!isFinalChunk && !hasSuffix(rawTextChunk, entryDelimiter)) {
    textChunkSuffix = rawTextChunks.pop();
  }

  const processedTextChunks = rawTextChunks
    .filter(v => v.trim() !== '')
    .map(v => JSON.parse(v));

  return [ processedTextChunks, textChunkSuffix ];
}

function hasSuffix(s, suffix) {
  return s.substr(s.length - suffix.length) === suffix;
}
