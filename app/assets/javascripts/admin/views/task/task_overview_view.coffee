### define
underscore : _
backbone.marionette : marionette
worker!libs/viz.js : VizWorker
libs/pan_zoom_svg  : PanZoomSVG
moment : moment
routes : routes
###

class TaskOverviewView extends Backbone.Marionette.View

  ui :
    "graph" : ".graph"

  initialize : ->

    # Backbone.Marionette internal method
    @bindUIElements()

    @getSVG().done( (graphSource) =>
      VizWorker.send(
        source : graphSource
        format : "svg"
        layoutEngine : "neato"
      ).then(
        (svgResult) =>

          # remove error messages
          startIndex = svgResult.indexOf("<?xml")
          svgResult = svgResult.slice(startIndex, svgResult.length - 1)

          @ui.graph.html(svgResult)

          @setupPopovers()
          @setupPanZoom()

        (error) =>
          @ui.graph.html("<i class=\"fa fa-warning-sign\"></i>#{error.replace(/\n/g,"<br>")}")
      )
    )
  

  getSVG : ->

    jsRoutes.controllers.admin.TaskAdministration.overviewData().ajax().then( (data) =>

      { userInfos, taskTypes, projects } = data
      # extract users and add full names
      @users = _.pluck(userInfos, "user")
      @users.map( (user) -> user.name = user.firstName + " " + user.lastName )

      nodes = @buildNodes(taskTypes, projects)
      edges = @buildEdges(userInfos)

      @buildGraph(nodes, edges)
    )


  buildGraph : (nodes, edges) ->

    svgHead = """
              digraph G {
                size="10,10";
                overlap=false;
                graph [ bgcolor="transparent" ];
                node  [ fontname="Helvetica, Arial, sans-serif",
                        fontsize=10.5,
                        style=filled,
                        fillcolor="#ffffff",
                        pencolor="black"
                      ];
              """
    svgTail = "}"    
    svgHead + nodes + edges + svgTail


  buildNodes : (taskTypes, projects) ->

    svgTaskTypes = taskTypes.map( (taskType) => @quoted(taskType.summary) + ";")
    svgProjects = projects.map( (project) => @quoted(project.name) + ";" )

    svgUsers = @users.map( (user) =>
      userName = user.firstName + " " + user.lastName
      lastActivityDays = moment().diff(user.lastActivity, 'days')
      color = @colorJet(Math.min(50, lastActivityDays) * (128 / 50) + 128)

      @quoted(userName) + " [id="+ @quoted(user._id["$oid"]) + ", shape=box, fillcolor=" + @quoted(color) + "];"
    )

    svgTaskTypes + svgUsers + svgProjects


  buildEdges : (userInfos) ->
    
    svgTaskEdges = userInfos.map( (userInfo) =>
      { user, taskTypes } = userInfo
      taskTypes.map( (taskType) => @edge(user.name, taskType.summary))
    )


    svgProjectEdges = userInfos.map( (userInfo) =>
      { user, projects } = userInfo
      projects.map( (project) => @edge(user.name, project.name))
    )

    
    svgFutureTaskTypesEdges  = "edge [ color=blue ];"
    svgFutureTaskTypesEdges += userInfos.map( (userInfo) =>
      { user, futureTaskType } = userInfo
      @edge(user.name, futureTaskType.summary)
    )


    svgTaskEdges + svgProjectEdges + svgFutureTaskTypesEdges


  setupPanZoom : ->

    # reset some attributes before invoking panZoom plugin
    $svg = @$(".graph.well").find("svg")
    
    # get rid of the troublemaker. messes up transformations
    $svg[0].removeAttribute("viewBox")
    
    $svg[0].setAttribute("width", "#{$(window).width() - 100}px")
    $svg[0].setAttribute("height", "#{$(window).height() - 50 - $svg.offset().top}px" )
    $svg.css("max-width", "100%")

    new PanZoomSVG($svg)


  setupPopovers : ->

    @users.forEach( (user) =>
      $("#" + user._id["$oid"]).popover(
        title: user.firstName + " " + user.lastName,
        html: true,
        trigger: "hover",
        content: @createUserTooltip(user),
        container: 'body'
      )
    )


  createUserTooltip : (user) ->

    lastActivityDays = moment().diff(user.lastActivity, 'days')
    
    ["Last Activity: #{lastActivityDays} days ago",
     "Experiences:",
      _.map(user.experiences, (domain, value) -> domain + " : " + value ).join("<br />")
    ].join("<br />")



  # utility functions

  colorJet : (value) ->

    fourValue = value / 64
    
    clamp = (value, min, max) -> return Math.min(Math.max(value, min), max)
    
    componentToHex = (c) ->
      hex = Math.floor(c * 255).toString(16)
      if hex.length == 1 then "0" + hex else hex

    rgbToHex = (r, g, b) -> "#" + [r, g, b].map(componentToHex).join("")
    
    r = clamp(Math.min(fourValue - 1.5, -fourValue + 4.5), 0, 1)
    g = clamp(Math.min(fourValue - 0.5, -fourValue + 3.5), 0, 1)
    b = clamp(Math.min(fourValue + 0.5, -fourValue + 2.5), 0, 1)
          
    rgbToHex(r, g, b)

  
  quoted : (str) -> '"' + str + '"'
  
  edge : (a, b) -> @quoted(a) + "->" + @quoted(b) + ";"

