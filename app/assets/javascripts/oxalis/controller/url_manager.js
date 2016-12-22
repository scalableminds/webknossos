app       = require("app")
backbone  = require("backbone")
constants = require("../constants")
{V3}      = require("libs/mjs")

class UrlManager


  MAX_UPDATE_INTERVAL : 1000

  constructor : (@model) ->

    @baseUrl      = document.location.pathname + document.location.search
    @initialState = @parseUrl()

    @update = _.throttle(
      => location.replace(@buildUrl())
      @MAX_UPDATE_INTERVAL
    )

    _.extend(@, Backbone.Events)


  parseUrl : ->

    # State string format:
    # x,y,z,mode,zoomStep[,rotX,rotY,rotZ][,activeNode]

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
    @listenTo(@model, "change:mode", @update)

    if @model.skeletonTracing
      @listenTo(@model.skeletonTracing, "newActiveNode", @update)


  buildUrl : ->

    { flycam, flycam3d } = @model
    state = V3.floor(flycam.getPosition())
    state.push( @model.mode )

    if @model.mode in constants.MODES_ARBITRARY
      state = state
        .concat( [flycam3d.getZoomStep().toFixed(2)] )
        .concat( _.map flycam3d.getRotation(), (e) -> e.toFixed(2) )

    else
      state = state.concat( [flycam.getZoomStep().toFixed(2)] )

    if @model.skeletonTracing?.getActiveNodeId()?
      state.push(@model.skeletonTracing.getActiveNodeId())

    return @baseUrl + "#" + state.join(",")

module.exports = UrlManager
