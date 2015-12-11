_                    = require("lodash")
SortedCollection     = require("../sorted_collection")
DatasetModel         = require("./dataset_model")

class DatasetCollection extends Backbone.Collection

  url : "/api/datasets"
  model : DatasetModel

module.exports = DatasetCollection
