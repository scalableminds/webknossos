// process-shim.js
// This file provides the process global that some modules expect
import process from 'process/browser';

// Make it available globally
if (typeof globalThis !== 'undefined') {
  globalThis.process = process;
} else if (typeof window !== 'undefined') {
  window.process = process;
} else if (typeof global !== 'undefined') {
  global.process = process;
}

// Also provide a fallback for when process is accessed directly
export { process };
export default process;