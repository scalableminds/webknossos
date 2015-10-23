_        = require("lodash")
backbone = require("backbone")

class DatasetAccesslistCollection extends Backbone.Collection

  constructor : (datasetId) ->
    @url = "/api/datasets/#{datasetId}/accessList"
    super()

module.exports = DatasetAccesslistCollection
