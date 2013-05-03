### define
worker!director_client.worker.min.js : Worker
underscore : _
jquery : $
routes : routes
###

class StackViewer

  constructor : ->

    $(".stack-display a").click (event) =>

      event.preventDefault()
      $el = $(event.currentTarget).parent()

      $el.html("<div class=\"loading-indicator\"><i class=\"icon-refresh icon-spin\"></i></div>")

      levelName = $el.parents("#stack-list").data("levelname")
      stackUrl = event.currentTarget.href
      @loadStack(stackUrl).then( 

        (stack) => 

          $canvas = $("<canvas>").prop(width : stack.meta.width, height : stack.meta.height)
          context = $canvas[0].getContext("2d")
          imageData = context.createImageData(stack.meta.width, stack.meta.height)

          $slider = $("<input>", type : "range", min : 0, max : stack.meta.length - 1, value : 0)
          $el
            .html("")
            .append($canvas, $slider, "<pre class=\"stack-meta\">#{JSON.stringify(stack.meta, null, " ")}</pre>")

          $slider
            .on("change", (event) ->
              imageData.data.set(stack.croppedImages[event.target.value].data)
              context.putImageData(imageData, 0, 0)
            )
            .change()

        -> 
          $el.html("Error loading stack.")

      )


  loadStack : _.memoize (stackUrl) ->

    Worker.send( method : "loadStackData", args : [ stackUrl ] )


