### define 
../buffer_utils : BufferUtils
###


class Fade

  PUBLIC : true
  COMMAND : "fade()"
  FRIENDLY_NAME : "Fade"  
  DESCRIPTION : "Fades the input rgba in or out"
  PARAMETER :
    input :
      rgba: "Uint8Array"
      absoluteTime: "int"
    start: "int"
    end: "int"
    mode: "\"in\", \"out\""
  EXAMPLES : [
      { description : "Filters the biggest segment of the nearest 3 with fade in and out", lines :
        [ "time(start : 0, end : 15) ->"
          "  importSlides(start : 0, end : 15)"
          "  filterSortedSegmentation(sorting: \"distance\", order: \"asc\", count: 3)"
          "  filterSortedSegmentation(sorting: \"size\", order: \"desc\", count: 2)"
          "  recolor(r: 0, g: 0, b: 255, a: 0.3)"
          "  fade(start: 0, end: 3, mode: \"in\") "
          "  fade(start: 12, end: 15, mode: \"out\") "
        ]
      }     
    ]    


  importSlides(start : 0, end : 15)
  filterSortedSegmentation(sorting: "distance", order: "asc", count: 3)
  filterSortedSegmentation(sorting: "size", order: "desc", count: 2)
  recolor(r: 0, g: 0, b: 255, a: 0.3)
  fade(start: 10, end: 15, mode: "in") 

  constructor : ->


  execute : ({ input , start, end, mode }) ->

    { rgba, absoluteTime } = input

    return unless start <= absoluteTime <= end

    t = (absoluteTime - start) / (end - start)
    
    t = 1 - t if mode == "out"

    newRgba = new Uint8Array(rgba.length)

    BufferUtils.alphaBlendBuffer(newRgba, rgba, t)

    input.rgba = newRgba
