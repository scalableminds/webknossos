$ = require("jquery")
_ = require("lodash")

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


  intToHex : (int, digits=6) ->

    return (_.repeat("0", digits) + int.toString( 16 )).slice(-digits)


  rgbToHex : (color) ->

    return "#" + color.map( (int) -> Utils.intToHex(int, 2) ).join("")


  hexToRgb : (hex) ->

    bigint = parseInt(hex[1..], 16)
    r = (bigint >> 16) & 255
    g = (bigint >> 8) & 255
    b = bigint & 255

    return [r, g, b]


  compareBy : (key, isSortedAscending=true) ->
    # generic key comparator for array.prototype.sort

    return (a, b) ->
      if not isSortedAscending
        [a,b] = [b,a]
      if a[key] < b[key]
        return -1
      if a[key] > b[key]
        return 1
      return 0


  stringToNumberArray : (s) ->

    # remove leading/trailing whitespaces
    s = s.trim()
    # replace remaining whitespaces with commata
    s = s.replace /,?\s+,?/g, ","
    stringArray = s.split(",")

    result = []
    for e in stringArray
      if not isNaN(newEl = parseFloat(e))
        result.push(newEl)

    return result


  loaderTemplate : ->

    return """
      <div id="loader-icon">
        <i class="fa fa-spinner fa-spin fa-4x"></i>
        <br>Loading
      </div>"""


  isElementInViewport : (el) ->

    #special bonus for those using jQuery
    if typeof jQuery == "function" && el instanceof jQuery
      el = el[0]


    rect = el.getBoundingClientRect()

    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    )


  # this is insecure and must not be used for security related functionality
  isUserAdmin : (user) ->
    if not user?
      return false
    else
      return _.findIndex(user.get("teams"), (team) ->
        team.role.name == "admin"
      ) >= 0


  getUrlParams : (paramName) ->
    # Parse the URL parameters as objects and return it or just a single param
    params = window.location.search.substring(1).split("&").reduce((result, value) ->
      parts = value.split('=')
      if parts[0]
        key = decodeURIComponent(parts[0])
        value = if parts[1] then decodeURIComponent(parts[1]) else true
        result[key] = value
      return result
    , {})

    if paramName then return params[paramName] else return params

module.exports = Utils
