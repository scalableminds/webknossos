### define
underscore : _
backbone : Backbone
./workload_model : WorkloadModel
../pagination_collection : PaginationCollection
###

class UserCollection extends PaginationCollection

  url : "/api/tasks/workload"
  model : WorkloadModel

  paginator_ui :
    perPage : 50

  parse : (response)->
    response.availableTasksCounts
