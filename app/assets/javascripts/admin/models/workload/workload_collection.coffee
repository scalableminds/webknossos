_                    = require("lodash")
Backbone             = require("backbone")

class WorkloadCollection extends Backbone.Collection

  url : "/api/tasks/workload"

  state :
    pageSize : 20

module.exports = WorkloadCollection
