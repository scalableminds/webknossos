/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import mockRequire from "mock-require";

mockRequire("app", {});

const { updateTypeAndId } = mockRequire.reRequire("oxalis/controller/url_manager.js");

test("UrlManager should replace tracing in url", (t) => {
  t.is(
    updateTypeAndId("abc/def/annotations/tracingType/tracingId", "newTracingType", "newTracingId"),
    "abc/def/annotations/newTracingType/newTracingId",
  );

  t.is(
    updateTypeAndId("abc/def/annotations/tracingType/tracingId/readOnly", "newTracingType", "newTracingId"),
    "abc/def/annotations/newTracingType/newTracingId/readOnly",
  );

  t.is(
    updateTypeAndId("abc/def/datasets/tracingId/view/rest", "newTracingType", "newTracingId"),
    "abc/def/datasets/newTracingId/view/rest",
  );
});
