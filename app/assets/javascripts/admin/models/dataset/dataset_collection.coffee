### define
underscore : _
../pagination_collection : PaginationCollection
./dataset_model : DatasetModel
###

class DatasetCollection extends PaginationCollection

  url : "/api/datasets" # TODO: ?isActive=true breaks importing in advanced view
  model : DatasetModel
