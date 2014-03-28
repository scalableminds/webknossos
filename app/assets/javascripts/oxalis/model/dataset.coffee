### define
libs/request : Request
libs/event_mixin : EventMixin
underscore : _
backbone : Backbone
backbone-deep-model : DeepModel
###

class Dataset extends Backbone.DeepModel


  constructor : (datasetName) ->

    @url = "/api/dataSetConfigurations/#{datasetName}"

    super()


  getSettings : ->

    return @attributes


  resetBrightnessContrastSettings : (datasetPostfix) ->

    Request.send(
      url : "/api/dataSetConfigurations/default"
      dataType : "json"
    ).then (defaultData) =>

      # @get("brightnessContrastSettings")[datasetPostfix] =
      #   defaultData.brightnessContrastSettings[datasetPostfix]

      # return @getOrCreateBrightnessContrastSettings(datasetPostfix)
      alert("FixMe")


  triggerAll : ->

    for property of @attributes
      @trigger(property + "Changed", @get(property))


  push : ->

    $.when(@pushThrottled())


  pushThrottled : ->

    saveFkt = @save
    @pushThrottled = _.throttle(_.mutexDeferred( saveFkt, -1), 10000)
    @pushThrottled()
