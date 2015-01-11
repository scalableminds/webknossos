### define
underscore : _
backbone : backbone
###

class DatasetAccesslistCollection extends Backbone.Collection

  constructor : (datasetId) ->
    @url = "/api/datasets/#{datasetId}/accessList"
    super()

