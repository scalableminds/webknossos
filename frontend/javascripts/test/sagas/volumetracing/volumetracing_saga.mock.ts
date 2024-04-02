import mockRequire from "mock-require";
import "test/mocks/lz4";

const REQUEST_ID = "dummyRequestId";
const UidMock = {
  getUid: () => REQUEST_ID,
};
mockRequire("libs/uid_generator", UidMock);
