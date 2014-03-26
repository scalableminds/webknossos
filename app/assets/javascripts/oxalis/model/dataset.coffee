### define
libs/request : Request
libs/event_mixin : EventMixin
underscore : _
backbone : Backbone
###

class Dataset extends Backbone.Model

  url : "/api/dataSetConfigurations/#{datasetName}"


  getSettings : ->

    return @attributes


  getMouseInversionX : ->

    return if @get("inverseX") then 1 else -1


  getMouseInversionY : ->

    return if @get("inverseY") then 1 else -1


  getOrCreateBrightnessContrastSettings : (datasetPostfix) ->

    settings = @get("brightnessContrastSettings")
    settings[datasetPostfix] = settings[datasetPostfix] || _.clone settings["default"]
    return settings[datasetPostfix]


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
