// Add more essential global mocks
import { vi } from "vitest";

import { annotationProto as SKELETON_ANNOTATION_PROTO } from "./fixtures/skeletontracing_server_objects";
import { annotationProto as VOLUME_ANNOTATION_PROTO } from "./fixtures/volumetracing_server_objects";

// Mock global objects
global.performance = {
  ...global.performance,
  now: vi.fn(() => Date.now()),
};

// Mock common utility functions
vi.mock("libs/keyboard", () => ({
  default: {
    bind: vi.fn(),
    unbind: vi.fn(),
    withContext: (_arg0: string, arg1: () => void) => arg1(),
  },
}));

vi.mock("libs/toast", () => ({
  default: {
    error: vi.fn(),
    warning: vi.fn(),
    close: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("libs/user_local_storage", () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
}));

const REQUEST_ID = "dummyRequestId";
vi.mock("libs/uid_generator", () => ({
  getUid: () => REQUEST_ID,
}));

// mock "libs/date", Date.now() and new Date();
export const TIMESTAMP = 1494695001688; // This variable can not be used direct in the mock function above. Vitest does not allow this.
vi.setSystemTime(TIMESTAMP);

vi.mock("libs/request", () => {
  return {
    default: {
      receiveJSON: vi.fn(),
      sendJSONReceiveJSON: vi.fn(),
      receiveArraybuffer: vi.fn(),
      sendJSONReceiveArraybuffer: vi.fn(),
      sendJSONReceiveArraybufferWithHeaders: vi.fn(),
    },
  };
});

vi.mock("libs/error_handling", () => {
  return {
    default: {
      assertExtendContext: vi.fn(),
      assertExists: vi.fn(),
      assert: vi.fn(),
      notify: vi.fn(),
    },
  };
});

vi.mock("oxalis/workers/lz4_wasm_wrapper.ts", async () => {
  return await vi.importActual("lz4-wasm-nodejs");
});

vi.mock("oxalis/workers/byte_array_lz4_compression.worker", async () => {
  return await vi.importActual("oxalis/workers/slow_byte_array_lz4_compression.worker");
});

vi.mock("libs/progress_callback", () => {
  function createProgressCallback() {
    async function progressCallback() {
      return { hideFn: () => {} };
    }
    return progressCallback;
  }

  return {
    default: createProgressCallback,
  };
});

vi.mock("oxalis/model/helpers/proto_helpers", () => {
  return {
    parseProtoTracing: vi.fn(),
    parseProtoAnnotation: vi.fn(),
  };
});

// Mock the proto imports
vi.mock("Annotation.proto", () => ({
  default: JSON.stringify({
    NOT_USED_IN_TESTS: "currently the actual proto content is not used in the tests",
  }),
}));
vi.mock("ListOfLong.proto", () => ({
  default: JSON.stringify({
    NOT_USED_IN_TESTS: "currently the actual proto content is not used in the tests",
  }),
}));
vi.mock("SkeletonTracing.proto", () => ({ default: JSON.stringify(SKELETON_ANNOTATION_PROTO) }));
vi.mock("VolumeTracing.proto", () => ({ default: JSON.stringify(VOLUME_ANNOTATION_PROTO) }));

vi.mock("oxalis/model/helpers/shader_editor.ts", () => ({
  default: {
    addBucketManagers: vi.fn(),
    addMaterial: vi.fn(),
    destroy: vi.fn(),
  },
}));
