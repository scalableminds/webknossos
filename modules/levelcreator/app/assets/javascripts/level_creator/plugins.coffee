### define
./plugins/recolor : Recolor
./plugins/blur : Blur
./plugins/segment_importer : SegmentImporter
./plugins/filter_segmentation_by_distance : FilterSegmentationByDistance
./plugins/filter_sorted_segmentation : FilterSortedSegmentation
./plugins/draw_art_cells : DrawArtCells
./plugins/filter_probability_segmentation : FilterProbabilitySegmentation
./plugins/filter_start_segmentation : FilterStartSegmentation
./plugins/fade : Fade
./plugins/cloudify : Cloudify
###


class Plugins

  constructor : (assetHandler) ->
    
    @filterSortedSegmentation = new FilterSortedSegmentation()
    @filterSegmentationByDistance = new FilterSegmentationByDistance()
    @filterProbabilitySegmentation = new FilterProbabilitySegmentation()
    @filterStartSegmentation = new FilterStartSegmentation()
    @recolor = new Recolor(assetHandler)
    @blur = new Blur()
    @segmentImporter = new SegmentImporter()
    @cloudify = new Cloudify()
    @drawArtCells = new DrawArtCells()    
    @fade = new Fade()    
