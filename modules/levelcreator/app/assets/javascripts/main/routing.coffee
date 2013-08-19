### define
jquery : $
underscore : _
libs/toast : Toast
libs/keyboard : KeyboardJS
routes : routes
../level_creator : LevelCreator
../stack_viewer : StackViewer
###

$ ->

  route = (routes) ->

    optionalParam = /\((.*?)\)/g
    namedParam    = /(\(\?)?:\w+/g
    splatParam    = /\*\w+/g
    escapeRegExp  = /[\-{}\[\]+?.,\\\^$|#\s]/g

    routeToRegExp = (route) ->
      route = route
        .replace(escapeRegExp, '\\$&')
        .replace(optionalParam, '(?:$1)?')
        .replace(namedParam, (match, optional) ->
          if optional then match else '([^\/]+)'
        )
        .replace(splatParam, '(.*?)')
      new RegExp('^' + route + '$')

    url = window.location.pathname
    for route, script of routes
      if routeToRegExp(route).test(url)
        script.call($("#main-container")[0])
        return

  route

    "/levels/:levelId(/missions/:missionId)" : ->

      window.levelCreator = new LevelCreator()


    "/levels/:levelId/stacks" : ->

      window.stackViewer = new StackViewer()


    "/" : ->

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
        
        return if _.isNaN(count)

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