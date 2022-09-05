import mock from "mock-require";

// @ts-ignore
global.performance = {
  now: () => Date.now(),
};
