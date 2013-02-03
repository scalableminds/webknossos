### define
./plugins/recolor : Recolor
./plugins/blur : Blur
./plugins/segment_importer : SegmentImporter
./plugins/filter_segmentation_by_distance : FilterSegmentationByDistance
./plugins/filter_sorted_segmentation : FilterSortedSegmentation
./plugins/draw_art_cells : DrawArtCells
./plugins/filter_end_segmentation : FilterEndSegmentation
./plugins/filter_start_segmentation : FilterStartSegmentation
./plugins/fade : Fade
./plugins/cloudify : Cloudify
./plugins/write : Write
./plugins/filter_all : FilterAll
###


class Plugins

  constructor : (assetHandler) ->
    
    @filterSortedSegmentation = new FilterSortedSegmentation()
    @filterSegmentationByDistance = new FilterSegmentationByDistance()
    @filterEndSegmentation = new FilterEndSegmentation()
    @filterStartSegmentation = new FilterStartSegmentation()
    @filterAll = new FilterAll()
    @recolor = new Recolor(assetHandler)
    @write = new Write()
    @blur = new Blur()
    @segmentImporter = new SegmentImporter()
    @cloudify = new Cloudify()
    @drawArtCells = new DrawArtCells()    
    @fade = new Fade()    
