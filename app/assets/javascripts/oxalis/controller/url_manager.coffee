### define
app : app
backbone : backbone
../constants : constants
###

class UrlManager


  MAX_UPDATE_INTERVAL : 1000

  constructor : (@model) ->

    @baseUrl      = document.location.pathname
    @initialState = @parseUrl()

    @update = _.throttle(
      => location.replace(@buildUrl())
      @MAX_UPDATE_INTERVAL
    )

    _.extend(@, Backbone.Events)


  parseUrl : ->

    stateString = location.hash.slice(1)
    state = {}

    if stateString

      stateArray = stateString.split(",")
      if stateArray.length >= 5

        state.position = _.map stateArray.slice(0, 3), (e) -> +e
        state.mode     = +stateArray[3]
        state.zoomStep = +stateArray[4]

        if stateArray.length >= 8
          state.rotation = _.map stateArray.slice(5, 8), (e) -> +e
          if stateArray[8]?
            state.activeNode = +stateArray[8]
        else
          if stateArray[5]?
            state.activeNode = +stateArray[5]

    return state


  startUrlUpdater : ->

    @listenTo(@model.flycam, "changed", @update)
    @listenTo(@model.flycam3d, "changed", @update)
    @listenTo(app.vent, "changeViewMode", @update)

    if @model.skeletonTracing
      @listenTo(@model.skeletonTracing, "newActiveNode", @update)


  buildUrl : ->

    { flycam, flycam3d } = @model
    state = _.map flycam.getPosition(), (e) -> Math.floor(e)
    state.push( @model.mode )

    if @model.mode in constants.MODES_ARBITRARY
      state = state.concat( [flycam3d.getZoomStep().toFixed(2)] )
                   .concat( _.map flycam3d.getRotation(), (e) -> e.toFixed(2) )

    else
      state = state.concat( [flycam.getZoomStep().toFixed(2)] )

    if @model.skeletonTracing?.getActiveNodeId()?
      activeNode = @model.skeletonTracing.getActiveNodeId()
      state = state.concat([activeNode])

    return @baseUrl + "#" + state.join(",")
