### define
libs/request : Request
libs/event_mixin : EventMixin
underscore : _
###

class User

  # To add any user setting, you must define default values in
  # UserSettings.scala

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


  getOrCreateBrightnessContrastColorSettings : (model) ->

    settings = @get("brightnessContrastColorSettings")
    datasetSettings = settings[model.datasetPostfix] || {}

    for binary in model.getColorBinaries()
      datasetSettings[binary.name] = datasetSettings[binary.name] || {}
      _.defaults(datasetSettings[binary.name], settings.default)

    settings[model.datasetPostfix] = datasetSettings


  resetBrightnessContrastColorSettings : (model) ->

    Request.send(
      url : "/user/configuration/default"
      dataType : "json"
    ).then (defaultData) =>

      @get("brightnessContrastColorSettings")[model.datasetPostfix] =
        defaultData.brightnessContrastColorSettings[model.datasetPostfix]

      @getOrCreateBrightnessContrastColorSettings(model)


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
