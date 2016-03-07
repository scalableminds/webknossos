Backbone = require("backbone")

class TaskOverviewCollection extends Backbone.Collection

  url : "/api/statistics/assignments"


module.exports = TaskOverviewCollection
