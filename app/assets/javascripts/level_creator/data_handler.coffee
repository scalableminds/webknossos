### define
jquery : $
underscore : _
routes : Routes
libs/event_mixin : EventMixin
libs/request : Request
./buffer_utils : BufferUtils
###

class DataHandler

	constructor : (@dimensions, @levelId, @taskId) ->

		EventMixin.extend(this)

		[ @width, @height, @depth ] = @dimensions

		@addDeferred("initialized")

		$.when(@requestRGBA()).done ( rgba ) =>
			@data = { rgba }
			@trigger("initialized")


	requestRGBA : ->

    Request.send(
      _.extend(
        Routes.controllers.BinaryData.arbitraryViaAjax(@levelId, @taskId)
        dataType : "arraybuffer"
      )
    ).pipe (buffer) => new Uint8Array(buffer)
      

  getGrayscaleSlide : (t) ->

    t = Math.min(t, @depth - 1)
    delta = t - Math.floor(t)

    slideLength = @width * @height

    lowerData = new Uint8Array(
      @data.rgba.subarray(Math.floor(t) * slideLength, Math.floor(t + 1) * slideLength)
    )

    return lowerData if delta == 0

    upperData = @data.rgba.subarray(Math.floor(t + 1) * slideLength, Math.floor(t + 2) * slideLength)

    for i in [0...slideLength] by 1
      lowerData[i] = lowerData[i] + delta * (upperData[i] - lowerData[i])

    lowerData


  getRGBASlide : (t) ->

    BufferUtils.copyGrayscaleBufferToRGBABuffer( @getGrayscaleSlide(t) )


  getSegmentationSlide : (t) ->

    t = Math.min(Math.round(t), @depth - 1)

    slideLength = @width * @height

    new Uint8Array(
      @data.segmentation.subarray(t * slideLength,t * slideLength)
    )

