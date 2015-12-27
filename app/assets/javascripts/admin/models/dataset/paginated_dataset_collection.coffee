PaginationCollection = require("admin/models/pagination_collection")
DatasetModel = require("admin/models/dataset/dataset_model")

class PaginatedDatasetCollection extends PaginationCollection

  url: "/api/datasets"
  model: DatasetModel

  state:
    pageSize : 10

module.exports = PaginatedDatasetCollection
