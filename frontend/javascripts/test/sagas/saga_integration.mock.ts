import "antd";
import { vi } from "vitest";

vi.mock("antd", () => {
  return {
    theme: {
      getDesignToken: () => ({ colorPrimary: "white" }),
      defaultAlgorithm: {},
    },
    Dropdown: {},
    message: {
      hide: vi.fn(),
      // These return a "hide function"
      show: vi.fn(() => () => {}),
      loading: vi.fn(() => () => {}),
      success: vi.fn(() => () => {}),
    },
    Modal: {
      confirm: vi.fn(),
    },
    Select: {
      Option: {},
    },
    Form: {
      Item: {},
    },
  };
});

vi.mock("libs/render_independently", () => ({ default: vi.fn() }));
