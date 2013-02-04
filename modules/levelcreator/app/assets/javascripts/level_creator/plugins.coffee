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
./plugins/draw_image : DrawImage
./plugins/color_all : ColorAll
###


class Plugins

  constructor : (assetHandler) ->
    
    @segmentImporter = new SegmentImporter()    
    @filterSortedSegmentation = new FilterSortedSegmentation()
    @filterSegmentationByDistance = new FilterSegmentationByDistance()
    @filterEndSegmentation = new FilterEndSegmentation()
    @filterStartSegmentation = new FilterStartSegmentation()
    @filterAll = new FilterAll()
    @recolor = new Recolor(assetHandler)
    @colorAll = new ColorAll()
    @write = new Write()
    @drawImage = new DrawImage(assetHandler)
    @blur = new Blur()
    @cloudify = new Cloudify()    
    @drawArtCells = new DrawArtCells()    
    @fade = new Fade()    
