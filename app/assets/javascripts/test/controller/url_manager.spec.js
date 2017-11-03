/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import mockRequire from "mock-require";

mockRequire("app", {});

const { updateTypeAndId } = mockRequire.reRequire("oxalis/controller/url_manager.js");

test("UrlManager should replace tracing in url", t => {
  t.is(
    updateTypeAndId(
      "abc/def/annotations/tracingType/annotationId",
      "newTracingType",
      "newAnnotationId",
    ),
    "abc/def/annotations/newTracingType/newAnnotationId",
  );

  t.is(
    updateTypeAndId(
      "abc/def/annotations/tracingType/annotationId/readOnly",
      "newTracingType",
      "newAnnotationId",
    ),
    "abc/def/annotations/newTracingType/newAnnotationId/readOnly",
  );
});
