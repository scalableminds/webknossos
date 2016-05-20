utils = require("./utils")


TemplateHelpers =

  COLOR_MAP : ["#6962C5", "#403C78", "#B2B1C4", "#6D6C78", "#C4C4C4", "#FF5000", "#899AC4", "#523C78"]

  stringToColor : (role) ->

    hash = @hashString(role)
    return @COLOR_MAP[hash]


  hashString : (string) ->

    hash = 0
    for i in string
      hash += string.charCodeAt(i)

    return hash % @COLOR_MAP.length


  formatScale : (scaleArr) ->
    if scaleArr?.length > 0
      scaleArrRounded = scaleArr.map((value) -> utils.roundTo(value, 2))
      return "(" + scaleArrRounded.join(', ') + ")"
    else
      return ""

module.exports = TemplateHelpers
