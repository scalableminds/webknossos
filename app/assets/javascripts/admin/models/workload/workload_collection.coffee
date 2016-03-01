_                    = require("lodash")
Backbone             = require("backbone")
PaginationCollection = require("../pagination_collection")

class WorkloadCollection extends PaginationCollection

  url : "/api/tasks/workload"

  state :
    pageSize : 20

module.exports = WorkloadCollection
