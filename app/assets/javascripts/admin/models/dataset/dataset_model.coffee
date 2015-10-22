_              = require("lodash")
backbone       = require("backbone")
NestedObjModel = require("nested_obj_model")

class DatasetModel extends NestedObjModel

  urlRoot : "/api/datasets"
  idAttribute : "name"

  parse : (response) ->

    # since defaults doesn't override null...
    if response.dataSource == null
      response.dataSource =
        needsImport : true
        baseDir : ""
        scale : []
        dataLayers : []

    response.hasSegmentation = _.some(response.dataSource.dataLayers,
      (layer) -> layer.category == "segmentation")

    response.thumbnailURL = @createThumbnailURL(response.name, response.dataSource.dataLayers)

    return response


  createThumbnailURL : (datasetName, layers) ->

    if colorLayer = _.findWhere(layers, category : "color")
      return "/api/datasets/#{datasetName}/layers/#{colorLayer.name}/thumbnail"

module.exports = DatasetModel
