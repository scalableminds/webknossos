// @noflow
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'mock... Remove this comment to see the full error message
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
  message: {
    show: () => {},
    hide: () => {},
    loading: () => {},
    success: () => {},
  },
});
mockRequire("libs/toast", {
  error: _.noop,
  warning: _.noop,
  close: _.noop,
  success: _.noop,
});
