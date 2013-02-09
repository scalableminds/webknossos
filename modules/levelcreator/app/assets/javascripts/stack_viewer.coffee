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

      [a, levelName, stackId] = event.currentTarget.href.match(/stack-([^-]+)-([0-9a-f]+)$/)
      @loadStack(levelName, stackId).then( (stack) => 
        @loadImages(levelName, stackId, stack.images).then( 
          
          (images...) =>

            $canvas = $("<canvas>").prop(width : stack.width, height : stack.height)
            $slider = $("<input>", type : "range", min : 0, max : stack.length, value : 0)
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


  loadStack : _.memoize (levelName, stackId) ->

    $.ajax(
      url : "/stacks/#{levelName}/#{stackId}/meta.json"
      dataType : "json"
    )


  loadImages : _.memoize( (levelName, stackId, imageNames) ->

    deferreds = for imageName in imageNames

      deferred = new $.Deferred()
      image = new Image()

      do (deferred, image, imageName) ->

        $(image)
          .on(
            "load" : -> deferred.resolve(image)
            "error" : -> deferred.reject()
          )
          .prop( src : "/stacks/#{levelName}/#{stackId}/#{imageName}" )


        deferred

    $.when(deferreds...)

  , (args...) -> args.toString())


