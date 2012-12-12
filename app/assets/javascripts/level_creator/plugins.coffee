### define
./plugins/recolor : Recolor
./plugins/blur : Blur
###


class Plugins

  constructor : (assetHandler) ->

    @recolor = new Recolor(assetHandler)
    @blur = new Blur()