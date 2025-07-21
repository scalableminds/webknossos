import { M4x4 } from "libs/mjs";

// Apply the default 180 z axis rotation to identity matrix as this is always applied on every flycam per default.
// This can be useful in tests to get a calculated rotation of [0, 0, 0]. Otherwise it would be  [0, 0, 180].
export const FlycamMatrixWithDefaultRotation = M4x4.rotate(Math.PI, [0, 0, 1], M4x4.identity(), []);
