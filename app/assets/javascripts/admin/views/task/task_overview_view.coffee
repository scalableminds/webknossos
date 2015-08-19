### define
underscore : _
backbone.marionette : marionette
worker!libs/viz.js : VizWorker
libs/pan_zoom_svg  : PanZoomSVG
moment : moment
routes : routes
daterangepicker : DateRangePicker
rangeslider : RangeSlider
libs/utils : Utils
admin/models/team/team_collection : TeamCollection
admin/views/selection_view : SelectionView
###

class TaskOverviewView extends Backbone.Marionette.LayoutView

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
        <div id="rangeSliderLabels">
          <span id="rangeSliderLabel1"/>
          <span id="rangeSliderLabel2"/>
          <span id="rangeSliderLabel3"/>
        </div>
        <div id="colorLegend"></div>
      </div>

      <div class="graph well">
        <p><i class="fa fa-refresh rotating"></i>Loading ...</p>
      </div>
  """)

  regions :
    "teamRegion" : ".team"

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

  chosenMinHours : 0
  chosenMaxHours : 24 * 356 * 100


  initialize : ->

    defaultStartDate = moment().startOf("day").subtract(@DEFAULT_TIME_PERIOD_TIME, @DEFAULT_TIME_PERIOD_UNIT).valueOf()
    defaultEndDate = moment().endOf("day").valueOf()
    @fetchData(defaultStartDate, defaultEndDate)

    @listenTo(@model, "change", @renderRangeSlider)


  fetchData : (start, end) ->

    @minMaxHours = {}
    @fetchPromise = @model.fetch(
      data:
        start: start
        end: end
    )


  getMinMaxHours : ->

    if _.isEmpty(@minMaxHours)
      minTime = Math.min(_.pluck(@model.attributes.userInfos, "workingTime")...)
      maxTime = Math.max(_.pluck(@model.attributes.userInfos, "workingTime")...)

      # Convert ms to h
      @minMaxHours =
        min: Math.floor(minTime / @MS_PER_HOUR)
        max: Math.ceil(maxTime / @MS_PER_HOUR)
      if @minMaxHours.min == @minMaxHours.max
        @minMaxHours.max += 1

    return @minMaxHours


  updateSelectedTeam : ->

    @team = @ui.team.find("select")[0].value


  onRender : ->

    @ui.taskTypesCheckbox.prop("checked", true)
    @initializeDateRangePicker()
    @renderTeamDropdown()
    @renderRangeSlider()
    @paintGraph()


  initializeDateRangePicker : ->

    @ui.dateRangeInput.daterangepicker(
      locale:
        format: 'L'
      startDate: moment().subtract(@DEFAULT_TIME_PERIOD_TIME, @DEFAULT_TIME_PERIOD_UNIT).format("L")
      endDate: moment().format("L")
      opens: "left"
    (start, end, label) =>
      @fetchData(start.valueOf(), end.valueOf())
      @paintGraph()
    )
    return


  renderTeamDropdown : ->

    TeamSelectionView = SelectionView.extend(
      events:
        change: 'teamChanged'
      teamChanged: =>
        @updateSelectedTeam()
        @paintGraph()
    )

    # sort the collection so the default team is the first one
    teamCollection = new TeamCollection()
    teamCollection.comparator = (teams) =>
      if teams.get("name") == @DEFAULT_TEAM then 0 else 1

    teamSelectionView = new TeamSelectionView(
      collection: teamCollection
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      name: "team"
    )

    @teamRegion.show(teamSelectionView)
    @listenTo(teamSelectionView, "render", => @updateSelectedTeam())


  renderRangeSlider : ->

    sliderEl = @ui.rangeSliderInput[0]

    @fetchPromise.done( =>
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

      sliderEl.noUiSlider.on('update', (values, handle) =>
        @chosenMinHours = Math.round(+values[0])
        @chosenMaxHours = Math.round(+values[1])
        @ui.rangeSliderLabel1[0].innerHTML = "#{@chosenMinHours}h";
        @ui.rangeSliderLabel2[0].innerHTML = "#{Utils.roundTo((+values[0] + +values[1]) / 2, 1)}h";
        @ui.rangeSliderLabel3[0].innerHTML = "#{@chosenMaxHours}h";
        @paintGraphDebounced()
      )
    )


  paintGraphDebounced : ->

    paintFkt = => @paintGraph()
    @paintGraphDebounced = _.debounce(paintFkt, 500)
    @paintGraphDebounced()


  paintGraph : ->

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

  selectionChanged : ->

    @paintGraph()


  doDrawTaskTypes : ->

    $(@ui.taskTypesCheckbox).prop("checked")


  doDrawProjects : ->

    $(@ui.projectsCheckbox).prop("checked")


  doDrawUser : (user) ->

    isWithinWorkingHours = @chosenMinHours <= user.workingHours <= @chosenMaxHours
    isInTeam = @team in _.pluck(user.teams, "team")

    return isWithinWorkingHours and isInTeam


  getSVG : ->

    @fetchPromise.then( =>

      { userInfos, taskTypes, projects } = @model.attributes
      # move workingTime to user object and convert to hours
      userInfos.map( (userInfo) => userInfo.user.workingHours = Utils.roundTo(userInfo.workingTime / @MS_PER_HOUR, 2) )
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

    svgUsers = @users.map( (user) =>
      if @doDrawUser(user)
        userName = user.firstName + " " + user.lastName
        workingHours = user.workingHours
        minMaxHours = @getMinMaxHours()
        color = @colorJet(128 - (workingHours - minMaxHours.min) * (128 / minMaxHours.max - minMaxHours.min) + 128)

        @quoted(userName) + " [id="+ @quoted(user.id) + ", shape=box, fillcolor=" + @quoted(color) + "]"
    ).join(";")

    svgTaskTypes = ""
    svgProjects = ""

    if @doDrawTaskTypes()
      svgTaskTypes = taskTypes.map( (taskType) => @quoted(taskType.summary)).join(";")

    if @doDrawProjects()
      svgProjects = projects.map( (project) => @quoted(project.name)).join(";")


    svgTaskTypes + svgUsers + svgProjects


  buildEdges : (userInfos) ->

    svgTaskTypeEdges = ""
    svgFutureTaskTypesEdges = ""
    svgProjectEdges = ""

    if @doDrawTaskTypes()

      svgTaskTypeEdges = userInfos.map( (userInfo) =>
        { user, taskTypes } = userInfo
        taskTypes.map( (taskType) => @edge(user.name, taskType.summary)) if @doDrawUser(user)
      ).join(";")

      svgFutureTaskTypesEdges  = "edge [ color=blue ];"
      svgFutureTaskTypesEdges += userInfos.map( (userInfo) =>
        { user, futureTaskType } = userInfo
        if(futureTaskType)
          @edge(user.name, futureTaskType.summary) if @doDrawUser(user)
      ).join(";")


    if @doDrawProjects()
      svgProjectEdges = userInfos.map( (userInfo) =>
        { user, projects } = userInfo
        projects.map( (project) => @edge(user.name, project.name)) if @doDrawUser(user)
      ).join(";")


    svgTaskTypeEdges + svgProjectEdges + svgFutureTaskTypesEdges


  setupPanZoom : ->

    # reset some attributes before invoking panZoom plugin
    $svg = @$(".graph.well").find("svg")

    # get rid of the troublemaker. messes up transformations
    $svg[0].removeAttribute("viewBox")

    $svg[0].setAttribute("width", "#{$(window).width() - 400}px")
    $svg[0].setAttribute("height", "#{$(window).height() - 50 - $svg.offset().top}px" )
    $svg.css("max-width", "100%")

    new PanZoomSVG($svg)


  setupPopovers : ->

    @users.forEach( (user) =>
      $("#" + user.id).popover(
        title: user.firstName + " " + user.lastName,
        html: true,
        trigger: "hover",
        content: @createUserTooltip(user),
        container: 'body'
      )
    )


  createUserTooltip : (user) ->

    ["Working time: #{user.workingHours}h",
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

  edge : (a, b) -> @quoted(a) + "->" + @quoted(b)

