### define
underscore : _
backbone : Backbone
app : app
###

class User extends Backbone.Model

  url : "/api/user/userConfiguration"
  # To add any user setting, you must define default values in
  # UserSettings.scala


  initialize : ->

    @listenTo(@, "change", _.debounce((=> @save()), 500))


  getMouseInversionX : ->

    return if @get("inverseX") then 1 else -1


  getMouseInversionY : ->

    return if @get("inverseY") then 1 else -1


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

    for property of @attributes
      @trigger("change:#{property}", @, @get(property))


