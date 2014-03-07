### define
../constants : constants
###

class UrlManager


  constructor : (@controller, @model) ->

    url           = document.URL
    @baseUrl      = url.match(/^([^#]*)#?/)[1]
    @initialState = @parseUrl url


  parseUrl : (url)->

    stateString = url.match(/^.*#([\d.-]*(?:,[\d.-]*)*)$/)?[1]
    state       = {}

    if stateString?

      stateArray = stateString.split(",")
      return unless stateArray.length >= 5

      state.position = _.map stateArray.slice(0, 3), (e) -> +e
      state.mode     = +stateArray[3]
      state.zoomStep = +stateArray[4]

      if stateArray.length >= 8
        state.rotation = _.map stateArray.slice(5, 8), (e) -> +e

    return state



  startUrlUpdater : ->

    update = => @buildUrl()

    setInterval update, 1000


  buildUrl : ->

    { flycam, flycam3d } = @model
    state = _.map flycam.getPosition(), (e) -> Math.floor(e)
    state.push( @controller.mode )

    if @controller.mode in constants.MODES_ARBITRARY
      state = state.concat( [flycam3d.getZoomStep().toFixed(2)] )
                   .concat( _.map flycam3d.getRotation(), (e) -> e.toFixed(2) )

    else
      state = state.concat( [flycam.getZoomStep().toFixed(2)] )

    location.href = @baseUrl + "#" + state.join(",")
