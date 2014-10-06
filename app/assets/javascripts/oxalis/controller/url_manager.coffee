### define
app : app
backbone : backbone
../constants : constants
###

class UrlManager


  MAX_UPDATE_INTERVAL : 2000

  constructor : (@controller, @model) ->

    url           = document.URL
    @baseUrl      = url.match(/^([^#]*)#?/)[1]
    @initialState = @parseUrl url

    @update = _.throttle(
      => location.replace(@buildUrl())
      @MAX_UPDATE_INTERVAL
    )

    _.extend(@, Backbone.Events)


  parseUrl : (url)->

    stateString = url.match(/^.*#([\d.-]*(?:,[\d.-]*)*)$/)?[1]
    state       =
      position : null
      mode : null
      zoomStep : null

    if stateString

      stateArray = stateString.split(",")
      if stateArray.length >= 5

        state.position = _.map stateArray.slice(0, 3), (e) -> +e
        state.mode     = +stateArray[3]
        state.zoomStep = +stateArray[4]

        if stateArray.length >= 8
          state.rotation = _.map stateArray.slice(5, 8), (e) -> +e

    return state


  startUrlUpdater : ->

    @model.flycam.on
      changed : => @update()
    @model.flycam3d.on
      changed : => @update()

    @listenTo(app.vent, "changeViewMode", @update)


  buildUrl : ->

    { flycam, flycam3d } = @model
    state = _.map flycam.getPosition(), (e) -> Math.floor(e)
    state.push( @model.mode )

    if @model.mode in constants.MODES_ARBITRARY
      state = state.concat( [flycam3d.getZoomStep().toFixed(2)] )
                   .concat( _.map flycam3d.getRotation(), (e) -> e.toFixed(2) )

    else
      state = state.concat( [flycam.getZoomStep().toFixed(2)] )

    return @baseUrl + "#" + state.join(",")
