### define
underscore : _
backbone : Backbone
./dataset_model : DatasetModel
###

class DatasetCollection extends Backbone.Collection

  url : "/api/datasets"
  model : DatasetModel
