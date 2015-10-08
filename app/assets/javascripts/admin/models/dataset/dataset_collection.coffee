_                    = require("underscore")
PaginationCollection = require("../pagination_collection")
DatasetModel         = require("./dataset_model")

class DatasetCollection extends PaginationCollection

  url : "/api/datasets" # TODO: ?isActive=true breaks importing in advanced view
  model : DatasetModel

module.exports = DatasetCollection
