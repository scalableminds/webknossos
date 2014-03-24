### define
libs/request : Request
libs/event_mixin : EventMixin
underscore : _
backbone : Backbone
###

class User extends Backbone.Model

  url : "/user/configuration"

  # TODOs
  # - error handling


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
      url : "/user/configuration/default"
      dataType : "json"
    ).then (defaultData) =>

      @get("brightnessContrastSettings")[datasetPostfix] =
        defaultData.brightnessContrastSettings[datasetPostfix]

      return @getOrCreateBrightnessContrastSettings(datasetPostfix)


  triggerAll : ->

    for property of @attributes
      @trigger(property + "Changed", @get(property))


  push : ->

    $.when(@pushThrottled())


  pushThrottled : ->

    saveFkt = @save
    @pushThrottled = _.throttle(_.mutexDeferred( saveFkt, -1), 10000)
    @pushThrottled()
