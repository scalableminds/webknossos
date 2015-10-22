_                    = require("lodash")
SortedCollection     = require("../sorted_collection")
DatasetModel         = require("./dataset_model")


class DatasetCollection extends SortedCollection

  url : "/api/datasets"
  model : DatasetModel

module.exports = DatasetCollection
