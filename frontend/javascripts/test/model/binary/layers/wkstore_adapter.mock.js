// @noflow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */

import mockRequire from "mock-require";

const REQUEST_ID = "dummyRequestId";
const UidMock = {
  getUid: () => REQUEST_ID,
};
mockRequire("libs/uid_generator", UidMock);
