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

      $(document).on "click", "[data-prompt]", (event) ->

        event.preventDefault()
        prompt("Level id:", $(this).data("prompt"))



      $(document).on "click", "#level-list .produce-stacks", (event) -> 

        event.preventDefault()
        $this = $(this)

        return if $this.find(".icon-retweet.rotating").length > 0
        
        unless $(event.target).is("input")
          
          $row = $this.parents("tr").first()
          levelId = $row.data("levelid")
          count = $this.find("input").val()
          
          $.ajax(
            _.extend(
              dataType : "json"
              beforeSend : (xhr) -> console.log xhr
              routes.controllers.levelcreator.StackController.produce(levelId, count)
            )
          ).then(

            ( { messages } ) -> 
              Toast.message(messages)
              
              $viewStacks = $row.find(".view-stacks")
              stackCount = $viewStacks.html().match(/[0-9]+/)[0]
              $viewStacks.html($viewStacks.html().replace(stackCount, parseInt(stackCount) + parseInt(count)))

            (jqxhr) -> Toast.error(jqxhr.responseText || "Connection error.")

          ).always(
            -> $this.find(".icon-retweet").removeClass("rotating")
          )
          $this.find(".icon-retweet").addClass("rotating")

        return