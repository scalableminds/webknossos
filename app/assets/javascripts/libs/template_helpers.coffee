### define
###
TemplateHelpers =

  COLOR_MAP : ["#6962C5", "#403C78", "#B2B1C4", "#6D6C78", "#C4C4C4", "#FF5000", "#899AC4", "#523C78"]

  roleToColor : (role) ->

    hash = @hashString(role)
    console.log(role, hash)
    return @COLOR_MAP[hash]


  hashString : (string) ->

    hash = 0
    for i in string
      hash += string.charCodeAt(i)
    console.log("before ", string, hash)

    return hash % @COLOR_MAP.length
