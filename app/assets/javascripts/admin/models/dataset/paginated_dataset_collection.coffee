### define
underscore : _
../pagination_collection : PaginationCollection
./dataset_model : DatasetModel
###

class PaginatedDatasetCollection extends PaginationCollection

  url : "/api/datasets"
  model : DatasetModel

  paginator_ui :
    perPage : 10
