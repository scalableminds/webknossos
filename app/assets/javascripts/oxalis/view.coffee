### define
jquery : $
../libs/toast : Toast
./constants : constants
./view/modal : modal
three : THREE
###

class View

  constructor : (@model, advancedOptionsAllowed) ->

    unless @isWebGlSupported()
      Toast.error("Couldn't initialise WebGL, please make sure you are using Google Chrome and WebGL is enabled.<br>"+
        "<a href='http://get.webgl.org/'>http://get.webgl.org/</a>")

    @renderer = new THREE.WebGLRenderer( clearColor: 0x000000, clearAlpha: 1.0, antialias: false )
    @scene = new THREE.Scene()

    @setTheme(constants.THEME_BRIGHT)

    # disable loader, show oxalis
    $("#loader").hide()
    $("#container").removeClass("hide")

    if not advancedOptionsAllowed
      $("#left-menu").hide()
      $("#right-menu").hide()


  toggleTheme : ->

    if @currentTheme is constants.THEME_BRIGHT
      @setTheme(constants.THEME_DARK)
    else
      @setTheme(constants.THEME_BRIGHT)


  setTheme : (theme) ->

    if theme is constants.THEME_BRIGHT
      $("body").attr('class', 'bright')
    else
      $("body").attr('class', 'dark')

    @currentTheme = theme


  isWebGlSupported : ->

    return window.WebGLRenderingContext and document.createElement('canvas').getContext('experimental-webgl')
