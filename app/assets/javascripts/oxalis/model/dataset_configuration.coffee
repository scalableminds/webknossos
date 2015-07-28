### define
libs/request : Request
underscore : _
backbone : Backbone
backbone-deep-model : DeepModel
###

class DatasetConfiguration extends Backbone.DeepModel


  initialize : ({datasetName, @dataLayerNames}) ->

    @url = "/api/dataSetConfigurations/#{datasetName}"
    @listenTo(@, "change", _.debounce((=> @save()), 500))
    @listenTo(@, "sync", => @setDefaultBinaryColors())


  reset : =>

    @setDefaultBinaryColors(true)

    Request.send(
      url : "/api/dataSetConfigurations/default"
      dataType : "json"
    ).done( (defaultData) =>
      @set("brightness", defaultData.brightness)
      @set("contrast", defaultData.contrast)
    )


  triggerAll : ->

    for property of @attributes
      @trigger("change:#{property}", @, @get(property))


  setDefaultBinaryColors : (forceDefault = false) ->

    layerColors = @get("layerColors")

    if @dataLayerNames.length == 1
      defaultColors = [[255, 255, 255]]
    else
      defaultColors = [[255, 0, 0], [0, 255, 0], [0, 0, 255],
                        [255, 255, 0], [0, 255, 255], [255, 0, 255]]

    for layerName, i in @dataLayerNames
      if forceDefault or not layerColors[layerName]
        color = defaultColors[i % defaultColors.length]
      else
        color = layerColors[layerName]
      @set("layerColors.#{layerName}", color)
