// Add more essential global mocks
import { vi } from 'vitest';

global.performance = {
  now: vi.fn(() => Date.now()),
};


// Mock the proto imports
vi.mock('Annotation.proto', () => ({
  default: {
    encode: () => ({ finish: () => new Uint8Array() }),
    decode: () => ({}),
  },
}));

vi.mock('ListOfLong.proto', () => ({
  default: {
    encode: () => ({ finish: () => new Uint8Array() }),
    decode: () => ({ list: [] }),
  },
}));

vi.mock('SkeletonTracing.proto', () => ({
  default: {
    encode: () => ({ finish: () => new Uint8Array() }),
    decode: () => ({ trees: [] }),
  },
}));

vi.mock('VolumeTracing.proto', () => ({
  default: {
    encode: () => ({ finish: () => new Uint8Array() }),
    decode: () => ({ cells: {} }),
  },
}));

// Mock lz4-wasm-nodejs
vi.mock("lz4-wasm-nodejs", () => ({
  compress: vi.fn(),
  decompress: vi.fn(),
}));

// vi.mock("lz4-wasm", () => ({
//   default: {
//     compress: vi.fn(),
//     decompress: vi.fn(),
//   },  
//   decompress: vi.fn(),
//   compress: vi.fn(),
// }));