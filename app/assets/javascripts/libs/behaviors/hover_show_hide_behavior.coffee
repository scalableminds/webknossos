### define
backbone.marionette : Marionette
###

class HowerShowHideBehavior extends Backbone.Marionette.Behavior

  events :
    "mouseenter .hover-dynamic" : "mouseEnter"
    "mouseleave .hover-dynamic" : "mouseLeave"
    "blur .hover-dynamic .hover-input" : "blur"

  mouseLeave : ->

    if not @$(".hover-input:focus").length
      @$(".hover-show").addClass("hide")
      @$(".hover-hide").removeClass("hide")


  mouseEnter : ->

    @$(".hover-show").removeClass("hide")
    @$(".hover-hide").addClass("hide")


  blur : (evt) ->

    window.setTimeout(
      =>
        @$(evt.target).parents(".hover-dynamic").find(".hover-show").addClass("hide")
        @$(evt.target).parents(".hover-dynamic").find(".hover-hide").removeClass("hide")
      , 200)
