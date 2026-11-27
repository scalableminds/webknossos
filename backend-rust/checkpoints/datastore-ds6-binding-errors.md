# DS6 route binding / parser errors

## Status
IN PROGRESS — captured actual Scala HTTP error fixtures; marker/module/helpers written. Parent owns lib.rs integration, focused tests next.

## Done
Live isolated Scala19491 verified ObjectId/missing/Int/Boolean/escaping binders always return Play production HTML for Accept text/html, application/json, text/plain and */*. Cached Play3.0.11 DefaultHttpErrorHandler bytecode confirms unconditional Twirl badRequest call (no negotiation). Schema{} JSON400 bypasses Action.fox cache/CORS; content-type text/plain415 uses HTML, syntax lone{400 uses Jackson detailed HTML; Rust preserves its actual serde diagnostic without a case-specific translation. New ClientError +BypassControllerHeaders markers separate binders/parsers/schema from unchanged Fox domain errors. Exact Twirl escaping includes apostrophe&#x27;.

## Next
Parent integrates module/render hooks; run focused actual-router fixture tests. Jackson syntax diagnostics remain explicitly divergent (serde diagnostics preserved, never fabricated). No broad parser parity claim.

## Evidence
23 independently captured Scala responses in datastore/tests/fixtures/binding_errors/scala_http.json and bodyfiles. Tokens not used in captured requests; Date header removed. JAR org/playframework/play_3/3.0.11/play_3-3.0.11.jar javap DefaultHttpErrorHandler/QueryStringBindable bindableInt; util ObjectId.pathBinder. Source-owned files binding_errors.rs,helpers.rs,error.rs only.

Milestone: binding_errors.rs fullstaticHTML/marker module, DsError binding constructor/persistent flag, helper binders/parser/schema markers and5 focused routertests ready/formatted. Parent lib.rs integration required; first compile stopped at missing crate::binding_errors. Retried only with parent shared CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-ds-verify, same missing module while parent wiring pending. No test-pass claim yet. WrongCT text/plain415 exactHTML supported; Scala text/json acceptance requires parent predispatch header adaptation because Axum Json extractor rejects it before helpers. Other Jackson syntax diagnostics explicitly remain different.

Milestone focused sharedtarget6tests:5passed exact20binderHTTPgoldens/escaping, schema{}headers/domainpreservation, content-type415HTML, syntactically malformed diagnostic preservation and markerwrap. Extraactualcaptures text/json +charset{}match parent normalization; [] exposed real RawCuboidRequest root-type reader mismatch (Rustpathmissing vsScalaexpectedJsObject). Rootcheck fix awaiting narrow model-file ownership, not response normalization. GlobalFields change rejected on inspection because manual Playfieldcombinators intentionally produce pathmissing for nonobject input.
