### define
jquery : $
underscore : _
libs/toast : Toast
libs/keyboard : KeyboardJS
###

$ ->

  route = (routes) ->

    javaTemplate = $("#main-container").data("template")

    javaTemplate = javaTemplate.match(/views\.html\.(.*)\$/)[1]

    if routes[javaTemplate]?
      routes[javaTemplate].call($("#main-container")[0])
    return


  route

    "levelcreator.levelCreator" : ->

      require ["./level_creator"], (LevelCreator) ->

        window.levelCreator = new LevelCreator()