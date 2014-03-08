### define
underscore : _
backbone.marionette : marionette
worker!libs/viz.js : VizWorker
libs/pan_zoom_svg  : PanZoomSVG
###

class TaskOverviewView extends Backbone.Marionette.View

  ui :
    "graphData" : "#graphData"
    "userData" : "#userData"
    "graph" : ".graph"


  initialize : ->

    @bindUIElements() #Backbone.Marionette internal method

    graphSource = @ui.graphData.html().replace( /"[^"]+"/gm, (a) -> a.replace(" "," ") )
    userData = JSON.parse(@ui.userData.html())

    VizWorker.send(
      source : graphSource
      format : "svg"
      layoutEngine : "neato"
    ).then(
      (svgResult) =>

        #remove error messages
        startIndex = svgResult.indexOf("<?xml")
        svgResult = svgResult.slice(startIndex, svgResult.length - 1)

        @ui.graph.html(svgResult)

        userData.map (user) ->
          $("#" + user.id + " > text").popover(
            title: user.name,
            html: true,
            trigger: "hover",
            content: user.tooltip,
            container: 'body'
          )

        #reset some attributes before invoking panZoom plugin
        $svg = @$(".graph.well").find("svg")
        $svg[0].removeAttribute("viewBox") #get rid of the troublemaker. messes up transformations
        $svg[0].setAttribute("width", "#{$(window).width() - 100}px")
        $svg[0].setAttribute("height", "#{$(window).height() - 50 - $svg.offset().top}px" )
        $svg.css("max-width", "100%")

        new PanZoomSVG($svg)

      (error) =>
        @ui.graph.html("<i class=\"fa fa-warning-sign\"></i>#{error.replace(/\n/g,"<br>")}")
    )
