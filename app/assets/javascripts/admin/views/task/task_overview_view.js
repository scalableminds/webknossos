_                = require("lodash")
Marionette       = require("backbone.marionette")
d3               = require("d3")
cola             = require("webcola")
moment           = require("moment")
routes           = require("routes")
RangeSlider      = require("nouislider")
Utils            = require("libs/utils")
TeamCollection   = require("admin/models/team/team_collection")
SelectionView    = require("admin/views/selection_view")
DateRangePicker  = require("bootstrap-daterangepicker")

class TaskOverviewView extends Marionette.View

  id : "task-overview"
  className : "container wide"
  template : _.template("""
      <h3>TaskType - User Overview</h3>
      <div>
        <p>All ovals symbolize task types and/or projects. Users are drawn as rectangles. Blue lines symbolize the next task type the user gets, after he has finished his current task. If the user currently has a task, then there is a black arrow drawn to the task type and/or the project of the task. </p>
      </div>
      <div class="overview-options">
        <label class="checkbox">
          <input type="checkbox" id="taskTypesCheckbox">Task types
        </label>
        <label class="checkbox">
          <input type="checkbox" id="projectsCheckbox">Projects
        </label>
        <label for="team">Team</label>
        <div class="team"></div>
        <label for="dateRangeInput">Date range</label>
        <input type="text" class="form-control" id="dateRangeInput"/>
        <label for="rangeSliderInput">Hour range</label>
        <div id="rangeSliderInput"></div>
        <div id="colorLegend"></div>
        <div id="rangeSliderLabels">
          <span id="rangeSliderLabel1"/>
          <span id="rangeSliderLabel2"/>
          <span id="rangeSliderLabel3"/>
        </div>
      </div>

      <div class="graph well">
        <p><i class="fa fa-refresh rotating"></i>Loading ...</p>
      </div>
  """)

  regions :
    "team" : ".team"

  events :
    "change @ui.taskTypesCheckbox" : "selectionChanged"
    "change @ui.projectsCheckbox" : "selectionChanged"

  ui :
    "graph" : ".graph"
    "taskTypesCheckbox" : "#taskTypesCheckbox"
    "projectsCheckbox" : "#projectsCheckbox"
    "team" : ".team"
    "dateRangeInput" : "#dateRangeInput"
    "rangeSliderInput" : "#rangeSliderInput"
    "rangeSliderLabel1" : "#rangeSliderLabel1"
    "rangeSliderLabel2" : "#rangeSliderLabel2"
    "rangeSliderLabel3" : "#rangeSliderLabel3"

  DEFAULT_TEAM : "Tracing crew"

  DEFAULT_TIME_PERIOD_UNIT : "month"
  DEFAULT_TIME_PERIOD_TIME : 3
  MS_PER_HOUR : 3600000

  # These values will be configured by the user, using the RangeSlider
  chosenMinHours : 0
  chosenMaxHours : 24 * 356 * 100

  # Graph constants
  FORCE_LAYOUT_TIMEOUT : 10000
  RECT_HEIGHT : 30
  TEXT_PADDING : 10
  OPTIONS_MARGIN : 30
  FUTURE_TASK_EDGE_COLOR : "#3091E6"
  MAX_SCALE : 3.0


  initialize : ->

    defaultStartDate = moment().startOf("day").subtract(@DEFAULT_TIME_PERIOD_TIME, @DEFAULT_TIME_PERIOD_UNIT).valueOf()
    defaultEndDate = moment().endOf("day").valueOf()
    @fetchData(defaultStartDate, defaultEndDate)

    @listenTo(@collection, "change", @renderRangeSlider)


  fetchData : (start, end) ->

    @fetchPromise = @collection.fetch(
      data:
        start: start
        end: end
    )
    @updateMinMaxHours()


  getMinMaxHours : ->

    # This function calculates the min/max working hours of the users of the selected team
    if _.isEmpty(@minMaxHours)
      selectedUsers = _.filter(@collection.get("userInfos"), (userInfo) => @team in _.map(userInfo.user.teams, "team"))
      workingTimes = _.map(selectedUsers, "workingTime")

      if _.isEmpty(workingTimes) then workingTimes = [0]
      minTime = Math.min(workingTimes...)
      maxTime = Math.max(workingTimes...)

      # Convert ms to h
      @minMaxHours =
        min: Math.floor(minTime / @MS_PER_HOUR)
        max: Math.ceil(maxTime / @MS_PER_HOUR)
      if @minMaxHours.min == @minMaxHours.max
        @minMaxHours.max += 1

    return @minMaxHours


  updateMinMaxHours : ->

    @fetchPromise.then( =>
      @minMaxHours = {}
      @getMinMaxHours()
    )


  updateSelectedTeam : ->

    @team = @ui.team.find("select")[0].value
    @updateMinMaxHours()
    @renderRangeSlider()


  onRender : ->

    @ui.taskTypesCheckbox.prop("checked", true)
    @initializeDateRangePicker()
    @renderTeamDropdown()
    @renderRangeSlider()
    _.defer(@buildGraph.bind(@))
    @paintGraphDebounced()


  initializeDateRangePicker : ->
    $(@ui.dateRangeInput[0]).daterangepicker({
      locale:
        format: "L"
      startDate: moment().subtract(@DEFAULT_TIME_PERIOD_TIME, @DEFAULT_TIME_PERIOD_UNIT).format("L")
      endDate: moment().format("L")
      opens: "left"
    },
    (start, end, label) =>
      @fetchData(start.valueOf(), end.valueOf())
      @paintGraphDebounced()
    )
    return


  renderTeamDropdown : ->

    TeamSelectionView = SelectionView.extend(
      teamChanged: =>
        @updateSelectedTeam()
        @paintGraphDebounced()
    )

    # sort the collection so the default team is the first one
    # don't bind the comparator function though as backbones sorting is
    # checking for the number of arguments which could lead to strange behaviour when bound
    defaultTeam = @DEFAULT_TEAM
    teamCollection = new TeamCollection(null,
      comparator: (teams) ->
        if teams.get("name") == defaultTeam then 0 else 1
    )

    teamSelectionView = new TeamSelectionView(
      collection: teamCollection
      childViewOptions:
        modelValue: -> return "#{@model.get("name")}"
      name: "team"
      events:
        change: "teamChanged"
    )

    @showChildView("team", teamSelectionView)
    @listenTo(teamSelectionView, "render", => @updateSelectedTeam())


  renderRangeSlider : ->

    sliderEl = @ui.rangeSliderInput[0]

    @fetchPromise.then( =>
      minMaxHours = @getMinMaxHours()

      # Destroy existing instance to reconfigure
      if sliderEl.noUiSlider
        sliderEl.noUiSlider.destroy()

      RangeSlider.create(sliderEl,
        start: [
          Math.max(minMaxHours.min, @chosenMinHours)
          Math.min(minMaxHours.max, @chosenMaxHours)
        ]
        connect: true
        step: 1
        margin: 1
        range: minMaxHours
      )

      sliderEl.noUiSlider.on("update", (values, handle) =>
        @chosenMinHours = Math.round(+values[0])
        @chosenMaxHours = Math.round(+values[1])
        @ui.rangeSliderLabel1.html("#{@chosenMinHours}h")
        @ui.rangeSliderLabel2.html("#{Utils.roundTo((+values[0] + +values[1]) / 2, 1)}h")
        @ui.rangeSliderLabel3.html("#{@chosenMaxHours}h")
        @paintGraphDebounced()
      )
    )


  paintGraphDebounced : ->

    paintFkt = @paintGraph.bind(@)
    @paintGraphDebounced = _.debounce(paintFkt, 500)
    @paintGraphDebounced()


  paintGraph : ->

    @renderSVG()


  selectionChanged : ->

    @paintGraph()


  doDrawTaskTypes : ->

    $(@ui.taskTypesCheckbox).prop("checked")


  doDrawProjects : ->

    $(@ui.projectsCheckbox).prop("checked")


  doDrawUser : (user) ->

    isWithinWorkingHours = @chosenMinHours <= user.workingHours <= @chosenMaxHours
    isInTeam = @team in _.map(user.teams, "team")

    return isWithinWorkingHours and isInTeam


  renderSVG : ->

    @fetchPromise.then( =>

      # { userInfos, taskTypes, projects } = @model.attributes
      # move workingTime to user object and convert to hours
      @collection.forEach((userInfoModel) => userInfoModel.get("user").workingHours = Utils.roundTo(userInfoModel.get("workingTime") / @MS_PER_HOUR, 2) )

      # extract users and add full names
      @users = @collection.pluck("user")
      @users.map( (user) -> user.name = user.firstName + " " + user.lastName )

      taskTypes = _.flatten(@collection.pluck("taskTypes"))
      projects = _.flatten(@collection.pluck("projects"))

      nodes = @buildNodes(taskTypes, projects)
      edges = @buildEdges(nodes)

      @updateGraph(nodes, edges)
    )


  buildGraph : ->

    width  = $(".graph").width() - @OPTIONS_MARGIN - $(".overview-options").width()
    height = $(window).height() - 50 - $(".graph").offset().top

    @svg = d3.select(".graph")
      .html("")
      .append("svg")
      .attr("width", width)
      .attr("height", height)

    @container = @svg.append("svg:g")

    @svgEdges = @container.append("svg:g").selectAll("path")
    @svgNodes = @container.append("svg:g").selectAll("g")

    @setupPanAndZoom()

    return


  updateGraph : (nodes, edges) ->

    # initialize nodes with random position as this yields faster results
    nodes.forEach( (n) =>
      n.x = Math.random() * @svg.attr("width")
      n.y = Math.random() * @svg.attr("height")
    )

    RECT_HEIGHT = @RECT_HEIGHT
    TEXT_PADDING = @TEXT_PADDING

    # stop existing force layout and cancel its timeout
    @force.stop() if @force
    clearTimeout(@forceTimeout) if @forceTimeout

    # clear old selection data and svg elements
    @svgEdges.remove()
    @svgEdges = @svgEdges.data([])
    @svgNodes.remove()
    @svgNodes = @svgNodes.data([])

    # append the svg path elements
    @svgEdges = @svgEdges.data(edges)
      .enter().append("svg:path")
      .attr("class", "link")
      .attr("stroke", (d) -> d.color )
      .attr("stroke-dasharray", (d) => if d.color is @FUTURE_TASK_EDGE_COLOR then "10,10")

    # append the container for the svg node elements
    @svgNodes = @svgNodes.data(nodes, (d) -> d.id)
    svgNodesContainer = @svgNodes.enter().append("svg:g")
      .attr("id", (d) -> d.id )

    # add the label to the svg node container
    svgNodesContainer.append("svg:text")
      .attr("class", "id")
      .text( (d) -> d.text )
      .each( (d) ->
        d.width = @getBBox().width + TEXT_PADDING
        d.height = RECT_HEIGHT
      )
      .attr("x", (d) -> d.width / 2 )
      .attr("y", RECT_HEIGHT / 2)

    # add the rectangle to the svg node container
    svgNodesContainer.insert("svg:rect", ":first-child")
      .attr("class", "node")
      .attr("width", (d) -> d.width )
      .attr("height", RECT_HEIGHT)
      .attr("rx", (d) -> if d.type is "user" then 3 else 10 )
      .attr("ry", (d) -> if d.type is "user" then 3 else 10 )
      .style("fill", (d) -> if d.color then d.color else "white")
      .style("stroke", (d) -> if d.color then d3.rgb(d.color).darker().toString() else "black")

    @zoomOnce = _.once(=> @zoomToFitScreen())

    # the force layout needs to be newly created every time
    # using the old one leads to incorrect layouts as colajs seems to mistakenly use old state
    @force = cola.d3adaptor()
      .size([@svg.attr("width"), @svg.attr("height")])
      .nodes(nodes)
      .links(edges)
      .symmetricDiffLinkLengths(200)
      .avoidOverlaps(true)
      .convergenceThreshold(0.10)
      .on("tick", @tick.bind(@))

    # unconstrained, user-constrained, overlap-constrained iterations
    @force.start(15, 0, 10)

    # stop force layout calculation after FORCE_LAYOUT_TIMEOUT ms
    @forceTimeout = setTimeout(@force.stop.bind(@force), @FORCE_LAYOUT_TIMEOUT)

    @setupPopovers()


  tick : ->

    # update the position of the edges
    # distribute the start and end point on the x-axis depending on their direction
    @svgEdges.attr("d", (d) ->
      deltaX = d.target.x - d.source.x
      deltaY = d.target.y - d.source.y
      dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
      normX = deltaX / dist
      sourcePadding = Math.min(25, d.source.width / 2)
      targetPadding = Math.min(25, d.target.width / 2)
      sourceX = d.source.x + (sourcePadding * normX)
      sourceY = d.source.y
      targetX = d.target.x - (targetPadding * normX)
      targetY = d.target.y
      return "M#{sourceX},#{sourceY}L#{targetX},#{targetY}"
    )

    # update the position of the nodes
    @svgNodes.attr("transform", (d) ->
      return "translate(#{d.x - d.width / 2},#{d.y - d.height / 2})"
    )

    # this will only be called after the first tick
    @zoomOnce()


  buildNodes : (taskTypes, projects) ->

    nodes = []

    nodes = nodes.concat(_.compact(@users.map( (user) =>
      if @doDrawUser(user)
        id: user.id
        text: user.firstName + " " + user.lastName
        color: @color((user.workingHours - @chosenMinHours) / (@chosenMaxHours - @chosenMinHours))
        type: "user"
    )))

    if @doDrawTaskTypes()
      nodes = nodes.concat(taskTypes.map( (taskType) ->
        id: taskType._id.$oid
        text: taskType.summary
        type: "taskType"
      ))

    if @doDrawProjects()
      nodes = nodes.concat(projects.map( (project) ->
        id: project._id.$oid
        text: project.name
        type: "project"
      ))

    return nodes


  buildEdges : (nodes) ->

    edges = []

    # only draw edges for users that are displayed in the graph
    selectedUserInfos = @collection.filter((userInfo) => @doDrawUser(userInfo.get("user")))

    if @doDrawTaskTypes()

      # task type edges
      edges = edges.concat(_.flatten(selectedUserInfos.map( (userInfo) =>
        user = userInfo.get("user")
        taskTypes = userInfo.get("taskTypes")
        taskTypes.map( (taskType) => @edge(user.id, taskType._id.$oid, nodes)) if @doDrawUser(user)
      )))

      # future task type edges
      edges = edges.concat(_.flatten(selectedUserInfos.map( (userInfo) =>
        user = userInfo.get("user")
        futureTaskType = userInfo.get("futureTaskType")
        if(futureTaskType)
          @edge(user.id, futureTaskType._id.$oid, nodes, @FUTURE_TASK_EDGE_COLOR) if @doDrawUser(user)
      )))

    # project edges
    if @doDrawProjects()
      edges = edges.concat(_.flatten(selectedUserInfos.map( (userInfo) =>
        user = userInfo.get("user")
        projects = userInfo.get("projects")
        projects.map( (project) => @edge(user.id, project._id.$oid, nodes)) if @doDrawUser(user)
      )))

    return _.compact(edges)


  setupPanAndZoom : ->

    @zoom = d3.behavior.zoom()
      .scaleExtent([0.1, 10])
      .on("zoom", =>
        @container.attr("transform", "translate(#{d3.event.translate})scale(#{d3.event.scale})")
      )

    @svg.call(@zoom)


  setupPopovers : ->

    @users.forEach( (user) =>
      $("#" + user.id).popover(
        title: user.firstName + " " + user.lastName,
        html: true,
        trigger: "hover",
        content: @createUserTooltip(user),
        container: "body"
      )
    )


  createUserTooltip : (user) ->

    ["Working time: #{user.workingHours}h",
     "Experiences:",
      _.map(user.experiences, (domain, value) -> domain + " : " + value ).join("<br />")
    ].join("<br />")


  zoomToFitScreen : ->

    transitionDuration = 400

    bounds = @container.node().getBBox()
    fullWidth = @svg.node().clientWidth
    fullHeight = @svg.node().clientHeight
    width = bounds.width
    height = bounds.height
    midX = bounds.x + width / 2
    midY = bounds.y + height / 2
    return if width == 0 || height == 0 # nothing to fit
    scale = 0.90 / Math.max(width / fullWidth, height / fullHeight)
    # limit scale to a reasonable magnification
    scale = Math.min(scale, @MAX_SCALE)
    translate = [fullWidth / 2 - scale * midX, fullHeight / 2 - scale * midY]

    @container
      .transition()
      .duration(transitionDuration || 0)
      .call(@zoom.translate(translate).scale(scale).event)



  # utility functions

  color : do ->
    # Red -> Yellow -> Green
    d3.scale.linear()
    .domain([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1])
    .range(["#a50026","#d73027","#f46d43","#fdae61","#fee08b","#ffffbf","#d9ef8b","#a6d96a","#66bd63","#1a9850","#006837"])

  edge : (idA, idB, nodes, color="black") ->
    source : _.find(nodes, "id" : idA)
    target : _.find(nodes, "id" : idB)
    color : color

module.exports = TaskOverviewView
