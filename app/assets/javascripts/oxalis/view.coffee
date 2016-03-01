$         = require("jquery")
app       = require("../app")
Toast     = require("../libs/toast")
THREE     = require("three")
constants = require("./constants")
modal     = require("./view/modal")

class View

  constructor : (@model) ->

    unless @isWebGlSupported()
      Toast.error("Couldn't initialise WebGL, please make sure you are using Google Chrome and WebGL is enabled.<br>"+
        "<a href='http://get.webgl.org/'>http://get.webgl.org/</a>")

    @renderer = new THREE.WebGLRenderer( clearColor: 0x000000, clearAlpha: 1.0, antialias: false )
    @scene = new THREE.Scene()

    @setTheme(constants.THEME_BRIGHT)

    # disable loader
    $("#loader").addClass("hidden")


  toggleTheme : ->

    if @theme is constants.THEME_BRIGHT
      @setTheme(constants.THEME_DARK)
    else
      @setTheme(constants.THEME_BRIGHT)


  setTheme : (theme) ->

    @theme = theme
    app.vent.trigger("view:setTheme", theme)

    if theme is constants.THEME_BRIGHT
      $("body").attr('class', 'bright')
    else
      $("body").attr('class', 'dark')



  isWebGlSupported : ->

    return window.WebGLRenderingContext and document.createElement('canvas').getContext('experimental-webgl')

module.exports = View
