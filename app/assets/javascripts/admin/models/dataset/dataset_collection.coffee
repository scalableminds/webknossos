### define
underscore : _
../pagination_collection : PaginationView
./dataset_model : DatasetModel
###

class DatasetCollection extends PaginationView

  url : "/api/datasets" # TODO: ?isActive=true breaks importing in advanced view
  model : DatasetModel
