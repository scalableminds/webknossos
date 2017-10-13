/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import "../enzyme/e2e-setup";
import test from "ava";
import Request from "libs/request";
import _ from "lodash";

test("Dashboard", async t => {
  const url = "/api/datasets";
  let datasets = await Request.receiveJSON(url);

  let retry = 0;
  while (JSON.stringify(datasets).indexOf("Not imported yet") === -1 && retry < 10) {
    // eslint-disable-next-line no-await-in-loop
    datasets = await Request.receiveJSON(url);
    retry++;
  }
  datasets = _.sortBy(datasets, d => d.name);

  t.snapshot(datasets, { id: "datasets" });
});
