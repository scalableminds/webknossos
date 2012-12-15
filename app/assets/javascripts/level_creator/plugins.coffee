### define
./plugins/recolor : Recolor
./plugins/blur : Blur
./plugins/segment_importer : SegmentImporter
./plugins/filter_segmentation_by_distance : FilterSegmentationByDistance
./plugins/draw_art_cells : DrawArtCells
./plugins/filter_probability_segmentation : FilterProbabilitySegmentation
./plugins/filter_start_segmentation : FilterStartSegmentation
./plugins/fade : Fade
###


class Plugins

  constructor : (assetHandler) ->

    @recolor = new Recolor(assetHandler)
    @blur = new Blur()
    @fade = new Fade()
    @segmentImporter = new SegmentImporter()
    @filterSegmentationByDistance = new FilterSegmentationByDistance()
    @filterProbabilitySegmentation = new FilterProbabilitySegmentation()
    @filterStartSegmentation = new FilterStartSegmentation()
    @drawArtCells = new DrawArtCells()