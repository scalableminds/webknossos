// @noflow

import mockRequire from "mock-require";
import * as antd from "antd";
import _ from "lodash";

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
mockRequire("libs/toast", { error: _.noop, warning: _.noop, close: _.noop, success: _.noop });
