### define
jquery : $
underscore : _
libs/toast : Toast
libs/keyboard : KeyboardJS
routes : routes
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


    "levelcreator.stackList" : ->

      require ["./stack_viewer"], (StackViewer) ->

        window.stackViewer = new StackViewer()


    "levelcreator.levelList" : ->

      $(document).on "click", "#level-list .produce", (event) -> 
        event.preventDefault()
        $this = $(this)

        return if $this.find(".icon-retweet.rotating").length > 0
        
        unless $(event.target).is("input")
          
          levelId = $this.parents("tr").first().data("levelid")
          count = $this.find("input").val()
          
          $.ajax(routes.controllers.levelcreator.LevelCreator.produce(levelId, count)).then(
            (msg) -> Toast.success(msg)
            (jqxhr) -> Toast.error(jqxhr.responseText ? "Connection error")
          ).always(
            -> $this.find(".icon-retweet").removeClass("rotating")
          )
          $this.find(".icon-retweet").addClass("rotating")

        return