### define
jquery : $
underscore : _
###

Utils =


  clamp : (a, x, b) ->

    Math.max(a, Math.min(b, x))


  zeroPad : (num, zeros = 0) ->

    num = "#{num}"
    while num.length < zeros
      num = "0#{num}"
    num


  unflatten : (array, tupleSize) ->

    for i in [0...array.length] by tupleSize
      array.slice(i, i + tupleSize)


  # sums up an array
  sum : (array, iterator) ->

    if _.isString(iterator) or _.isNumber(iterator)
      array.reduce(( (r, a) -> r + a[iterator] ), 0)
    else
      array.reduce(( (r, a) -> r + a ), 0)


  roundTo : (value, digits) ->

    digitMultiplier = Math.pow(10, digits)
    return Math.round(value * digitMultiplier) / digitMultiplier


  intToHex : (int) ->

    hex = int.toString(16)
    return if hex.length == 1 then "0" + hex else hex


  rgbToHex : ([r, g, b]) ->

    return "#" + Utils.intToHex(r) + Utils.intToHex(g) + Utils.intToHex(b)


  loaderTemplate : ->

    return """
      <div id="loader-icon">
        <i class="fa fa-spinner fa-spin fa-4x"></i>
        <br>Loading
      </div>"""
