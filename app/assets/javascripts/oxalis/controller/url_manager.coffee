### define
../constants : constants
###

class UrlManager


  MAX_UPDATE_INTERVAL : 1000

  constructor : (@controller, @model) ->

    @baseUrl      = document.location.pathname + document.location.search
    @initialState = @parseUrl()

    @update = _.throttle(
      => location.replace(@buildUrl())
      @MAX_UPDATE_INTERVAL
    )


  parseUrl : ->

    stateString = location.hash.slice(1)
    state       = {}

    if stateString?

      stateArray = stateString.split(",")
      return state unless stateArray.length >= 5

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

    @model.flycam.on
      changed : => @update()
    @model.flycam3d.on
      changed : => @update()
    @model.skeletonTracing?.on
      newActiveNode : => @update()


  buildUrl : ->

    { flycam, flycam3d } = @model
    state = _.map flycam.getPosition(), (e) -> Math.floor(e)
    state.push( @controller.mode )

    if @controller.mode in constants.MODES_ARBITRARY
      state = state.concat( [flycam3d.getZoomStep().toFixed(2)] )
                   .concat( _.map flycam3d.getRotation(), (e) -> e.toFixed(2) )

    else
      state = state.concat( [flycam.getZoomStep().toFixed(2)] )

    if @model.skeletonTracing?.getActiveNodeId()?
      activeNode = @model.skeletonTracing.getActiveNodeId()
      state = state.concat([activeNode])

    return @baseUrl + "#" + state.join(",")
