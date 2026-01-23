let mlMatrix: any = null;

export async function ensureMlMatrixLoaded() {
  if (!mlMatrix) {
    mlMatrix = await import("ml-matrix");
  }
}

export function getMlMatrix() {
  if (!mlMatrix) {
    throw new Error("ml-matrix is not loaded. Ensure it is loaded before use.");
  }
  return mlMatrix;
}
