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


      $(document).on "click", "#level-list .auto-render-stacks", (event) ->

        sendAutoRender = =>

          $row = $(this).parents("tr").first()
          levelId = $row.data("levelid")

          $.ajax(
            _.extend(
              routes.controllers.levelcreator.LevelCreator.autoRender(levelId, this.checked)
              dataType : "json"
            )
          ).then(

            ( { messages } ) -> Toast.message(messages)
            (jqxhr) -> Toast.error(jqxhr.responseText || "Connection error.")

          )

        if this.checked
          if confirm("Are you sure, you want to generate a ton of stacks for this level?")
            sendAutoRender()

          else
            this.checked = false
        else
          sendAutoRender()



      $(document).on "click", "#level-list .produce-stacks", (event) -> 

        event.preventDefault()
        $this = $(this)
      
        $row = $this.parents("tr").first()
        levelId = $row.data("levelid")
        count = parseInt(prompt("How many stacks to produce?", "3"))
        
        $.ajax(
          _.extend(
            dataType : "json"
            beforeSend : (xhr) -> console.log xhr
            routes.controllers.levelcreator.StackController.produce(levelId, count)
          )
        ).then(

          ( { messages } ) -> Toast.message(messages)
          (jqxhr) -> Toast.error(jqxhr.responseText || "Connection error.")

        )

        return