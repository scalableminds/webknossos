import "antd";
import { vi } from "vitest";

vi.mock("antd", () => ({
  theme: {
    getDesignToken: () => ({ colorPrimary: "white" }),
    defaultAlgorithm: {},
  },
  Dropdown: {},
  message: {
    hide: vi.fn(),
    // These return a "hide function"
    show: () => vi.fn(),
    loading: () => vi.fn(),
    success: () => vi.fn(),
  },
}));

vi.mock("libs/render_independently", () => ({ default: vi.fn() }));
