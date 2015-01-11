### define
underscore : _
admin/models/pagination_collection : PaginationCollection
./dataset_model : DatasetModel
###

class DatasetCollection extends PaginationCollection

  url : "/api/datasets"
  model : DatasetModel
