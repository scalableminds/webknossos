### define
../constants : constants
###

class UrlParser


  constructor : (@controller, @model) ->

    url           = document.URL
    @baseUrl      = url.match(/^(.*)#?/)[1]
    @initialState = @parseUrl url


  parseUrl : (url)->

    stateString = url.match(/^.*#([\d.]*(?:,[\d.]*)*)$/)?[1]

    if stateString?

      console.log "URL", stateString.split(",")


  startUrlUpdater : ->

    update = => @buildUrl()

    setInterval update, 1000


  buildUrl : ->

    { flycam, flycam3d } = @model
    state = flycam.getPosition()
    state.push( @controller.mode )

    if @controller.mode in constants.MODES_ARBITRARY
      state = state.concat( [flycam3d.getZoomStep()] )

    else
      state = state.concat( [flycam.getZoomStep()] )

    location.href = @baseUrl + "#" + state.join(",")
