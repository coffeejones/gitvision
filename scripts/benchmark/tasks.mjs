// Benchmark task set + INDEPENDENTLY-established ground truth.
//
// Ground truth was verified by direct grep/read of the repo at the pinned
// commit — NOT taken from CodeTrawl's output — so scoring isn't circular. The
// set is deliberately balanced: two tasks where an unaided grep-and-read agent
// should do fine (so the benchmark isn't rigged), three where cross-cutting
// structure is the answer (where the deterministic engine should pull ahead).
// `expectFavors` is the pre-registered hypothesis, recorded before running.

export const REPO = {
  name: "expressjs/express",
  url: "https://github.com/expressjs/express",
  ref: "ae6dd37680e3a00618d6c8a3e522f0ee4eeba1a4",
};

export const TASKS = [
  {
    id: "read-res-send",
    kind: "reading",
    expectFavors: "neutral",
    question:
      "What does the res.send method do in this repository? Describe its behavior at a high level.",
    groundTruth:
      "res.send (in lib/response.js) sends the HTTP response and handles multiple body types: a string is sent as-is (Content-Type defaults to text/html), a Buffer is sent with Content-Type defaulting to application/octet-stream, and an object/array/boolean/number is delegated to res.json (JSON-encoded). It sets the Content-Type header when not already set, computes and sets Content-Length, generates/sets an ETag when applicable, and strips the body plus Content-Type/Content-Length/Transfer-Encoding for 204 and 304 responses. It ends the response (and skips the body for HEAD requests).",
  },
  {
    id: "locate-res-download",
    kind: "locate",
    expectFavors: "agent",
    question:
      "In which file and at approximately what line number is the res.download method defined?",
    groundTruth:
      "res.download is defined in lib/response.js at line 435 (the line 'res.download = function download (path, filename, options, callback) {'). Any answer naming lib/response.js and a line within ~10 of 435 is correct.",
  },
  {
    id: "deps-of-response",
    kind: "blast-radius",
    expectFavors: "codetrawl",
    question:
      "Which files in this repository statically depend on lib/response.js — i.e. which files import/require it directly?",
    groundTruth:
      "Exactly one file: lib/express.js requires lib/response.js (line 21: \"var res = require('./response')\"). That is the only static import edge to lib/response.js in the codebase. (Express then attaches response.js's methods onto the HTTP response prototype, so the RUNTIME reach is broad — but the only static require of the module is from lib/express.js. A correct answer names lib/express.js as the sole static dependent; noting the prototype-augmentation caveat is a plus but not required.)",
  },
  {
    id: "untested-response-fns",
    kind: "untested-hotspots",
    expectFavors: "codetrawl",
    question:
      "Which functions in lib/response.js have NO direct test caller (i.e. no test file calls them directly, as opposed to exercising them over HTTP)? Name the most complex ones.",
    groundTruth:
      "Essentially all of lib/response.js's methods have no DIRECT test caller. Express's suite exercises them over HTTP via supertest (test files do require('..') and make requests), not by calling res.send/res.sendFile/etc. directly — only ~5 of 70 test files require anything under lib/ at all. The most complex functions that thus lack a direct test caller include send (the highest-complexity method), sendFile, download, and format/render. A correct answer states that direct-call coverage of response.js is essentially nil and names send (and ideally sendFile/download) as top untested-by-direct-call hotspots.",
  },
  {
    id: "direct-coverage-pct",
    kind: "coverage-metric",
    expectFavors: "codetrawl",
    question:
      "What fraction of production functions in this repository have a DIRECT test caller (a test that calls the function directly, not via an HTTP integration test)? Give an approximate percentage.",
    groundTruth:
      "Approximately 0%. The suite is almost entirely integration tests: roughly 65 of 70 test files use require('..') and drive the app over HTTP via supertest; only ~5 test files touch anything under lib/ directly. Direct-call coverage of production functions is effectively zero. Any answer in the 0–5% range with the right reasoning (integration-test-dominated suite) is correct; an answer claiming substantial direct coverage is wrong.",
  },
];
