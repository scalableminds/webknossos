_                    = require("lodash")
PaginationCollection = require("../pagination_collection")
DatasetModel         = require("./dataset_model")


class DatasetCollection extends PaginationCollection

  url : "/api/datasets"
  model : DatasetModel

module.exports = DatasetCollection
