### define
./plugins/recolor : Recolor
./plugins/blur : Blur
./plugins/segment_importer : SegmentImporter
./plugins/filter_segmentation_by_distance : FilterSegmentationByDistance
./plugins/draw_art_cells : DrawArtCells
###


class Plugins

  constructor : (assetHandler) ->

    @recolor = new Recolor(assetHandler)
    @blur = new Blur()
    @segmentImporter = new SegmentImporter()
    @filterSegmentationByDistance = new FilterSegmentationByDistance()
    @drawArtCells = new DrawArtCells()