### define
./plugins/recolor : Recolor
./plugins/blur : Blur
./plugins/segment_importer : SegmentImporter
###


class Plugins

  constructor : (assetHandler) ->

    @recolor = new Recolor(assetHandler)
    @blur = new Blur()
    @segmentImporter = new SegmentImporter()