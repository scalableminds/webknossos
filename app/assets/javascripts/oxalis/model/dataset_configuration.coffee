Request        = require("libs/request")
_              = require("lodash")
Backbone       = require("backbone")
NestedObjModel = require("libs/nested_obj_model")


class DatasetConfiguration extends NestedObjModel

  initialize : ({datasetName, @dataLayerNames}) ->

    @url = "/api/dataSetConfigurations/#{datasetName}"
    @listenTo(@, "change", _.debounce(
      => if app.currentUser? then @save()
      500))
    @listenTo(@, "sync", => @setDefaultBinaryColors())


  reset : =>

    @setDefaultBinaryColors(true)


  triggerAll : ->

    for property of @attributes
      @trigger("change:#{property}", @, @get(property))


  setDefaultBinaryColors : (forceDefault = false) ->

    layers = @get("layers")

    if @dataLayerNames.length == 1
      defaultColors = [[255, 255, 255]]
    else
      defaultColors = [[255, 0, 0], [0, 255, 0], [0, 0, 255],
                        [255, 255, 0], [0, 255, 255], [255, 0, 255]]

    for layerName, i in @dataLayerNames
      defaults =
        color: defaultColors[i % defaultColors.length]
        brightness: 0
        contrast: 1

      if forceDefault or not layers[layerName]
        layer = defaults
      else
        layer = _.defaults(layers[layerName], defaults)

      @set("layers.#{layerName}", layer)

module.exports = DatasetConfiguration
