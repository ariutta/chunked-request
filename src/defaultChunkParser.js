const entryDelimiters = ['\r\n', '\n'];

// The defaultParser expects the response from the server to consist of new-line
// delimited JSON, eg:
//
//  { "chunk": "#1", "data": "Hello" }\n
//  { "chunk": "#2", "data": "World" }
//
// It will correctly handle the case where a chunk is emitted by the server across
// delimiter boundaries.
export default function defaultParser(reader, onChunk, onError, onComplete) {
  const textDecoder = new TextDecoder();
  let trailer;

  function defaultChunkParser({ value, done }) {
    const chunkStr = value ? textDecoder.decode(value, {stream: !done}) : '';

    const jsonLiterals = entryDelimiters.reduce(function(acc, entryDelimiter) {
      return acc.reduce(function(subacc, x) {
        return subacc.concat(x.split(entryDelimiter));
      }, []);
    }, [chunkStr]);

    if (trailer) {
      jsonLiterals[0] = `${trailer}${jsonLiterals[0]}`;
    }

    // Is this a complete message?  If not, push the trailing (incomplete) string 
    // into the trailer. 
    if (!done && !hasSuffix(chunkStr, entryDelimiters)) {
      trailer = jsonLiterals.pop();
    } else {
      trailer = null;
    }

    return jsonLiterals
      .filter(v => v.trim() !== '')
      .map(v => JSON.parse(v));
  }

  function pump(reader) {
    return reader.read()
      .then(result => {
        const parsedChunk = defaultChunkParser(result);
        if (typeof parsedChunk !== 'undefined') {
          onChunk(parsedChunk);
        }
        if (result.done) {
          return onComplete();
        }
        return pump(reader);
      });
  }
  return pump(reader);
}

function hasSuffix(s, suffixes) {
  return suffixes.reduce(function(acc, suffix) {
    return acc || s.substr(s.length - suffix.length) === suffix;
  }, false);
}
