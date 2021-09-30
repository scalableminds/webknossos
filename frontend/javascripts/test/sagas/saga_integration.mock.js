// @noflow

import mockRequire from "mock-require";
import * as antd from "antd";

const REQUEST_ID = "dummyRequestId";
const UidMock = {
  getUid: () => REQUEST_ID,
};
mockRequire("libs/uid_generator", UidMock);
mockRequire("antd", {
  ...antd,
  Dropdown: {},
  message: { show: () => {}, hide: () => {}, loading: () => {}, success: () => {} },
});
