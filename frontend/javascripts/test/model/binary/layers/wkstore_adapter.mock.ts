// @noflow
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'mock... Remove this comment to see the full error message
import mockRequire from "mock-require";
const REQUEST_ID = "dummyRequestId";
const UidMock = {
  getUid: () => REQUEST_ID,
};
mockRequire("libs/uid_generator", UidMock);
