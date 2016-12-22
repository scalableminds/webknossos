SortedCollection     = require("../sorted_collection")
DatasetModel         = require("./dataset_model")

class DatasetCollection extends SortedCollection

  url : "/api/datasets"
  model : DatasetModel
  sortAttribute : "name"

module.exports = DatasetCollection
