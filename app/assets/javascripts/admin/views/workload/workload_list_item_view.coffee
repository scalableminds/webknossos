### define
underscore : _
backbone.marionette : Marionette
admin/models/workload/workload_collection : WorkloadCollection
###

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

