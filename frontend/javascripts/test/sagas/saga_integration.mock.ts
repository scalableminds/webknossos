import * as antd from "antd";
import _ from "lodash";
import mockRequire from "mock-require";
import "test/mocks/lz4";

const REQUEST_ID = "dummyRequestId";
const UidMock = {
  getUid: () => REQUEST_ID,
};

mockRequire("libs/uid_generator", UidMock);

mockRequire("antd", {
  ...antd,
  Dropdown: {},
  message: {
    hide: () => {},
    // These return a "hide function"
    show: () => () => {},
    loading: () => () => {},
    success: () => () => {},
  },
});

mockRequire("libs/toast", {
  error: _.noop,
  warning: _.noop,
  close: _.noop,
  success: _.noop,
});

mockRequire("libs/render_independently", _.noop);
