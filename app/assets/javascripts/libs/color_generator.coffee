THREE          = require("three")
ColorConverter = require("three.color")

GOLDEN_RATIO = 0.618033988749895

ColorGenerator = {
  distinctColorForId : (id) ->

    hue = id * GOLDEN_RATIO
    hue %= 1
    return ColorConverter.setHSV(
      new THREE.Color(), hue, 1, 1
    ).getHex()
}

module.exports = ColorGenerator
