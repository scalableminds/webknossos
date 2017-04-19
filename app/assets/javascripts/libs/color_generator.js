/*
 * color_generator.js
 * @flow
 */
import * as THREE from "three";
import type { Vector3 } from "oxalis/constants";

const GOLDEN_RATIO = 0.618033988749895;

const ColorGenerator = {
  distinctColorForId(id: number): Vector3 {
    let hue = id * GOLDEN_RATIO;
    hue %= 1;
    const color = new THREE.Color();
    color.setHSL(hue, 1, 0.5);
    return color.toArray();
  },
};

export default ColorGenerator;
