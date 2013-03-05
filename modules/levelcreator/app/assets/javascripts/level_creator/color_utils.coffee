### define
underscore : _
###

ColorUtils =

	  parseColor : (colorName) ->
    # http://stackoverflow.com/questions/11068240/what-is-the-most-efficient-way-to-parse-a-css-color-in-javascript

    if m = colorName.match(/^#([0-9a-fA-F]{3})$/i)
      # in three-character format, each value is multiplied by 0x11 to give an
      # even scale from 0x00 to 0xff
      return [
        parseInt(m[1].charAt(0),16)*0x11
        parseInt(m[1].charAt(1),16)*0x11
        parseInt(m[1].charAt(2),16)*0x11
        1
      ]

    if m = colorName.match(/^#([0-9a-fA-F]{4})$/i)
      # in three-character format, each value is multiplied by 0x11 to give an
      # even scale from 0x00 to 0xff
      return [
        parseInt(m[1].charAt(0), 16)*0x11
        parseInt(m[1].charAt(1), 16)*0x11
        parseInt(m[1].charAt(2), 16)*0x11
        parseInt(m[1].charAt(3), 16)*0x11 / 255
      ]

    if m = colorName.match(/^#([0-9a-fA-F]{6})$/i)
      return [
        parseInt(m[1].substr(0,2),16)
        parseInt(m[1].substr(2,2),16)
        parseInt(m[1].substr(4,2),16)
        1
      ]

    if m = colorName.match(/^#([0-9a-fA-F]{8})$/i)
      return [
        parseInt(m[1].substr(0,2),16)
        parseInt(m[1].substr(2,2),16)
        parseInt(m[1].substr(4,2),16)
        parseInt(m[1].substr(6,2),16) / 255
      ]

    if m = colorName.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i)
      return [
        parseInt(m[1])
        parseInt(m[2])
        parseInt(m[3])
        1
      ]

    if m = colorName.match(/^rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\,\s*(\d*\.?\w+)\s*\)$/i)
      return [
        parseInt(m[1])
        parseInt(m[2])
        parseInt(m[3])
        parseFloat(m[4])
      ]

    throw new Error("\"#{colorName}\" is not a valid color.")