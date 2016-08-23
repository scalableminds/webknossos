_                     = require("lodash")
Marionette            = require("backbone.marionette")
Toast                 = require("libs/toast")

class ProjectListItemView extends Marionette.CompositeView

  tagName : "tr"

  template : _.template("""
    <td><%= name %></td>
    <td><%= team %></td>
    <td><%= priority %></td>
    <% if(owner.email) { %>
      <td><%= owner.firstName %> <%= owner.lastName %> (<%= owner.email %>)</td>
    <% } else { %>
      <td>-</td>
    <% } %>
    <td><%= numberOfOpenAssignments %></td>
    <td class="nowrap">
      <a href="/annotations/CompoundProject/<%= name %>" title="View all finished tracings">
        <i class="fa fa-random"></i>view
      </a><br/>
      <a href="/projects/<%= name %>/edit" title="Edit Tasks">
        <i class="fa fa-pencil"></i>edit
      </a><br/>
      <a href="/projects/<%= name %>/tasks" title="View Tasks">
        <i class="fa fa-tasks"></i>tasks
      </a><br/>
      <a href="/api/projects/<%= name %>/download" title="Download all finished tracings">
        <i class="fa fa-download"></i>download
      </a><br/>
      <a href="#" class="delete">
        <i class="fa fa-trash-o"></i>delete
      </a>
    </td>
  """)

  events :
    "click .delete" : "deleteProject"


  deleteProject : ->

    if window.confirm("Do you really want to delete this project?")
      xhr = @model.destroy(
        wait : true
      )

module.exports = ProjectListItemView
