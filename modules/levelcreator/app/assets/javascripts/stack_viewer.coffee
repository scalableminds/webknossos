### define
underscore : _
jquery : $
routes : routes
###

class StackViewer

  constructor : ->

    $(".stack-display a").click (event) =>

      $el = $(event.currentTarget).parent()

      $el.html("<div class=\"loading-indicator\"><i class=\"icon-refresh rotating\"></i></div>")

      [a, levelId, stackId] = event.currentTarget.href.match(/stack-([0-9a-f]+)-([0-9a-f]+)$/)
      @loadStack(levelId, stackId).then( (stack) => 
        @loadImages(stack.name, stackId, stack.depth).then( 
          
          (images...) =>

            $canvas = $("<canvas>").prop(width : stack.width, height : stack.height)
            $slider = $("<input>", type : "range", min : 0, max : stack.depth, value : 0)
            $el
              .html("")
              .append($canvas, "<br />", $slider)

            $slider
              .on("change", (event) ->
                context = $canvas[0].getContext("2d")
                context.clearRect(0, 0, stack.width, stack.height)
                context.drawImage(images[event.target.value], 0, 0)
              )
              .change()

          -> 
            $el.html("Error loading images.")
        )
      )


  loadStack : _.memoize (levelId, stackId) ->

    $.ajax(
      url : routes.controllers.levelcreator.LevelCreator.meta(levelId).url
      dataType : "json"
    ).then (stack) ->
      _.extend(stack, { levelId, stackId })


  loadImages : _.memoize( (levelName, stackId, imageCount) ->

    deferreds = for i in [0..imageCount]

      deferred = new $.Deferred()
      image = new Image()

      do (deferred, image, i) ->

        $(image)
          .on(
            "load" : -> deferred.resolve(image)
            "error" : -> deferred.reject()
          )
          .prop( src : "/stacks/#{levelName}/#{stackId}/stackImage#{i}.png" )


        deferred

    $.when(deferreds...)

  , (args...) -> args.toString())


