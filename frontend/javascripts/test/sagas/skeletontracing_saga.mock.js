// @noflow

import mockRequire from "mock-require";

const REQUEST_ID = "dummyRequestId";
const UidMock = {
  getUid: () => REQUEST_ID,
};
mockRequire("libs/uid_generator", UidMock);
