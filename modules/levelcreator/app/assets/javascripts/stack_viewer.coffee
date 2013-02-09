### define
underscore : _
jquery : $
###

class StackViewer

  constructor : ->

    $(".collapse").toArray().forEach (el) =>

      $el = $(el).on

        "show" : (event) =>

          $el = $(event.target).find(".accordion-inner")

          $el.html("<i class=\"icon-refresh rotating\"></i> Loading...")

          @loadStack($el.prop("id")).then( (stack) => 
            @loadImages(stack).then( 
              
              (images...) =>

                $image = $("<img>", width : stack.width, height : stack.height)
                $slider = $("<input>", type : "range", min : 0, max : stack.depth, value : 0)
                $el
                  .html("")
                  .append($image, "<br />", $slider)

                $slider
                  .on("change", (event) ->
                    $image.prop( src : images[event.target.value].src )
                  )
                  .change()

              -> 
                $el.html("Error loading images.")
            )
          )

        "hidden" : (event) =>

          $el.html("")


  loadStack : _.memoize (stackId) ->

    new $.Deferred( (a) -> a.resolve( width : 300, height : 200, depth : 30, images : [  ] ) )


  loadImages : _.memoize (stack) ->

    deferreds = for i in [0..stack.depth]

      deferred = new $.Deferred()
      image = new Image()

      do (deferred, image, i) ->

        $(image)
          .on(
            "load" : -> deferred.resolve(image)
            "error" : -> deferred.reject()
          )
          .prop( src : "http://placehold.it/#{300 + i}x#{200 - i}" )


        deferred

    $.when(deferreds...)


