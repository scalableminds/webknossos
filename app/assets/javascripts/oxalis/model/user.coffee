### define
libs/request : Request
libs/event_mixin : EventMixin
underscore : _
###

class User

  # To add any user setting, you must define default values in
  # UserConfiguration.scala

  constructor : (user) ->

    _.extend(this, new EventMixin())
    @userSettings = {}
    _.extend(@userSettings, user)


  setByName : (name, value) ->

    @userSettings[name] = value
    @trigger(name + "Changed", value)
    @push()


  setByObject : (object) ->

    for name of object
      @setByName(name, object[name])


  set : (arg1, arg2) ->

    if _.isObject(arg1)
      @setByObject(arg1)
    else
      @setByName(arg1, arg2)


  get : (name) ->

    return @userSettings[name]


  getSettings : ->

    return @userSettings


  getMouseInversionX : ->

    return if @userSettings.inverseX then 1 else -1


  getMouseInversionY : ->

    return if @userSettings.inverseY then 1 else -1


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

    for property of @userSettings
      @trigger(property + "Changed", @get(property))


  push : ->

    $.when(@pushThrottled())


  pushThrottled : ->

    saveFkt = @pushImpl
    @pushThrottled = _.throttle(_.mutexDeferred( saveFkt, -1), 10000)
    @pushThrottled()


  pushImpl : ->

    tracingId   = $("#container").data("tracing-id")
    tracingType = $("#container").data("tracing-type")

    $.ajax(url : "/sharedannotations/#{tracingType}/#{tracingId}/isShared").done((shared) =>

      if not shared.isShared

        deferred = $.Deferred()

        console.log "Sending User Data:", @userSettings

        Request.send(
          url      : "/user/configuration"
          type     : "POST"
          dataType : "json"
          data     : @userSettings
        ).fail( =>

          console.log "couldn't save userdata"

        ).always(-> deferred.resolve())

        deferred.promise()

      else
        console.log "Shared annotation"
    )

