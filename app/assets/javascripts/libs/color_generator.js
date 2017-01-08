import THREE from "three";
import ColorConverter from "three.color";

const GOLDEN_RATIO = 0.618033988749895;

const ColorGenerator = {
  distinctColorForId(id) {
    let hue = id * GOLDEN_RATIO;
    hue %= 1;
    return ColorConverter.setHSV(
      new THREE.Color(), hue, 1, 1,
    ).getHex();
  },
};

export default ColorGenerator;
