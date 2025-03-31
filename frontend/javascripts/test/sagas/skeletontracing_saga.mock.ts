import "test/mocks/lz4";
import { vi } from "vitest";

const REQUEST_ID = "dummyRequestId";

vi.mock("libs/uid_generator", () => ({
  getUid: () => REQUEST_ID,
}));
