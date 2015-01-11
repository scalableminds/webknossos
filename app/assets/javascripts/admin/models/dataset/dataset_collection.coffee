### define
underscore : _
../pagination_collection : PaginationView
./dataset_model : DatasetModel
###

class DatasetCollection extends PaginationView

  url : "/api/datasets?isActive=true"
  model : DatasetModel
