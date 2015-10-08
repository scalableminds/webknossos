_                  = require("underscore")
Marionette         = require("backbone.marionette")
WorkloadCollection = require("admin/models/workload/workload_collection")

class WorkloadListItemView extends Backbone.Marionette.CompositeView
  tagName : "tr"
  template : _.template("""
      <td><%= name %></td>
      <td><%= projectsString() %></td>
      <td><%= availableTaskCount %></td>
  """)

  templateHelpers: ->
    projectsString: ->
      @projects.join(", ")


module.exports = WorkloadListItemView
