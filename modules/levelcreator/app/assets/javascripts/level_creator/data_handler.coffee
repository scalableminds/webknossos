### define
jquery : $
underscore : _
routes : Routes
libs/event_mixin : EventMixin
libs/request : Request
libs/toast : Toast
./buffer_utils : BufferUtils
###

class DataHandler

  constructor : (@dimensions, @levelId, @taskId) ->

    EventMixin.extend(this)

    [ @width, @height, @depth ] = @dimensions

    @addDeferred("initialized")

    $.when(
      @requestGray()
      @requestSegmentation()
      @requestClassification()
    ).then(

      ( gray, segmentation, classification ) =>

        @data = { gray, segmentation, classification }
        @trigger("initialized")
        
    )


  requestGray : ->

    Request.send(
      _.extend(
        Routes.controllers.levelcreator.ArbitraryBinaryData.viaAjax("color", @levelId, @taskId)
        dataType : "arraybuffer"
      )
    ).then(
      (buffer) => new Uint8Array(buffer)
      (xhr) -> Toast.error("Couldn't load color data layer.")
    )


  requestSegmentation : ->

    Request.send(
      _.extend(
        Routes.controllers.levelcreator.ArbitraryBinaryData.viaAjax("segmentation", @levelId, @taskId)
        dataType : "arraybuffer"
      )
    ).then(
      (buffer) => new Uint16Array(buffer)
      (xhr) -> Toast.error("Couldn't load segmentation data layer.")
    )


  requestClassification : ->

    Request.send(
      _.extend(
        Routes.controllers.levelcreator.ArbitraryBinaryData.viaAjax("classification", @levelId, @taskId)
        dataType : "arraybuffer"
      )
    ).then(
      (buffer) => new Uint8Array(buffer)
      (xhr) -> Toast.error("Couldn't load classification data layer.")
    )
      

  getGrayscaleSlide : (t) ->

    t = Math.min(t, @depth - 1)
    delta = t - Math.floor(t)

    slideLength = @width * @height

    lowerData = new Uint8Array(
      @data.gray.subarray(Math.floor(t) * slideLength, Math.floor(t + 1) * slideLength)
    )

    return lowerData if delta == 0

    upperData = @data.gray.subarray(Math.floor(t + 1) * slideLength, Math.floor(t + 2) * slideLength)

    for i in [0...slideLength] by 1
      lowerData[i] = lowerData[i] + delta * (upperData[i] - lowerData[i])

    lowerData


  getRGBASlide : (t) ->

    BufferUtils.copyGrayscaleBufferToRGBABuffer( @getGrayscaleSlide(t) )


  getSegmentationSlide : (t) ->

    #t = Math.min(Math.round(t), @depth - 1)

    slideLength = @width * @height

    new Uint16Array(
      @data.segmentation.subarray(Math.floor(t) * slideLength, Math.floor(t + 1) * slideLength)
    )

