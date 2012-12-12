### define
./plugins/recolor : Recolor
./plugins/blur : Blur
./plugins/segment_importer : SegmentImporter
./plugins/filter_segments_by_distance : FilterSegmentsByDistance
###


class Plugins

  constructor : (assetHandler) ->

    @recolor = new Recolor(assetHandler)
    @blur = new Blur()
    @segmentImporter = new SegmentImporter()
    @filterSegmentsByDistance = new FilterSegmentsByDistance()