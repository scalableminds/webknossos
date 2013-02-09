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

  DATA_SET_ID : "2012-09-28_ex145_07x2"

  constructor : (@dimensions, @levelId, @taskId) ->

    EventMixin.extend(this)

    [ @width, @height, @depth ] = @dimensions

    @addDeferred("initialized")

    $.when(
      @requestMissionData()
    ).then(
      ( mission ) =>

        $.when(
          @requestGray(mission.start.id)
          @requestSegmentation(mission.start.id)
          @requestClassification(mission.start.id)
        ).then(
          ( gray, segmentation, classification ) =>

            @data = { gray, segmentation, classification, mission }
            @trigger("initialized")
        )
    )    


  requestGray : (startId) ->

    Request.send(
      _.extend(
        Routes.controllers.levelcreator.ArbitraryBinaryData.missionViaAjax(@DATA_SET_ID, @levelId, startId, "color")
        dataType : "arraybuffer"
      )
    ).then(
      (buffer) => new Uint8Array(buffer)
      (xhr) -> Toast.error("Couldn't load color data layer.")
    )


  requestSegmentation : (startId) ->

    Request.send(
      _.extend(
        Routes.controllers.levelcreator.ArbitraryBinaryData.missionViaAjax(@DATA_SET_ID, @levelId, startId, "segmentation")
        dataType : "arraybuffer"
      )
    ).then(
      (buffer) => new Uint16Array(buffer)
      (xhr) -> Toast.error("Couldn't load segmentation data layer.")
    )


  requestClassification : (startId) ->

    Request.send(
      _.extend(
        Routes.controllers.levelcreator.ArbitraryBinaryData.missionViaAjax(@DATA_SET_ID, @levelId, startId, "classification")
        dataType : "arraybuffer"
      )
    ).then(
      (buffer) => new Uint8Array(buffer)
      (xhr) -> Toast.error("Couldn't load classification data layer.")
    )


  requestMissionData : ->

    Request.send(
      _.extend(
        Routes.controllers.levelcreator.MissionController.getMission(@DATA_SET_ID, @taskId)
        dataType : "json"
      )
    ).then(
      (mission) => mission
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
