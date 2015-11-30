### define
underscore : _
backbone : Backbone
../pagination_collection : PaginationCollection
###

class WorkloadCollection extends PaginationCollection

  url : "/api/tasks/workload"

  paginator_ui :
    perPage : 20
