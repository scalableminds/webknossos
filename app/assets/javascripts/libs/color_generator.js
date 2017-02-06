import * as THREE from "three";

const GOLDEN_RATIO = 0.618033988749895;

const ColorGenerator = {
  distinctColorForId(id) {
    let hue = id * GOLDEN_RATIO;
    hue %= 1;
    const color = new THREE.Color();
    color.setHSL(hue, 1, 0.5);
    return color.getHex();
  },
};

export default ColorGenerator;
