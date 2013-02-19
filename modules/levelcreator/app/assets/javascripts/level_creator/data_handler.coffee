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

  constructor : (@dimensions, @levelId, @missionId, @dataSetName) ->

    EventMixin.extend(this)

    [ @width, @height, @depth ] = @dimensions

    @addDeferred("initialized")

    $.when(
      @requestGray()
      @requestSegmentation()
      @requestClassification()
      @requestMissionData()
    ).then(
      ( gray, segmentation, classification, mission ) =>

        @data = { gray, segmentation, classification, mission }
        @trigger("initialized")
    )  


  requestGray : ->

    Request.send(
      _.extend(
        Routes.controllers.levelcreator.BinaryData.viaAjax(@dataSetName, @levelId, @missionId, "color")
        dataType : "arraybuffer"
      )
    ).then(
      (buffer) => new Uint8Array(buffer)
      (xhr) -> Toast.error("Couldn't load color data layer.")
    )


  requestSegmentation : ->

    Request.send(
      _.extend(
        Routes.controllers.levelcreator.BinaryData.viaAjax(@dataSetName, @levelId, @missionId, "segmentation")
        dataType : "arraybuffer"
      )
    ).then(
      (buffer) => new Uint16Array(buffer)
      (xhr) -> Toast.error("Couldn't load segmentation data layer.")
    )


  requestClassification : ->

    Request.send(
      _.extend(
        Routes.controllers.levelcreator.BinaryData.viaAjax(@dataSetName, @levelId, @missionId, "classification")
        dataType : "arraybuffer"
      )
    ).then(
      (buffer) => new Uint8Array(buffer)
      (xhr) -> Toast.error("Couldn't load classification data layer.")
    )


  requestMissionData : ->

    Request.send(
      _.extend(
        Routes.controllers.levelcreator.MissionController.getMission(@missionId)
        dataType : "json"
      )
    ).then(
      _.identity
      (xhr) -> Toast.error("Couldn't load meta data.")
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

    t = Math.min(t, @depth - 1)
    delta = t - Math.floor(t)

    slideLength = @width * @height

    if delta <= 0.5
      segmentationData = new Uint16Array(
        @data.segmentation.subarray(Math.floor(t) * slideLength, Math.floor(t + 1) * slideLength)
      )
    else
      segmentationData = new Uint16Array(
        @data.segmentation.subarray(Math.floor(t + 1) * slideLength, Math.floor(t + 2) * slideLength)
      )    

    segmentationData


  getMissionData : ->

    @data.mission
