_               = require("lodash")
Marionette      = require("backbone.marionette")
TemplateHelpers = require("libs/template_helpers")

class TeamListItemView extends Marionette.View

  tagName : "tr"
  template : _.template("""
    <td><%- name %></td>
    <td><% if(parent){ %><%- parent %><% } %></td>
    <td><% if(owner){ %> <%- owner.firstName %> <%- owner.lastName %> (<%- owner.email %>)<% }else{ %> - <% } %></td>
    <td>
      <% _.each(roles, function(role){ %>
          <span class="label label-default" style="background-color: <%- TemplateHelpers.stringToColor(role.name) %>"><%- role.name %></span>
      <% }) %>
    </td>
    </td>
    <td class="nowrap">
      <% if(amIOwner){ %>
        <a href="#" class="delete"><i class="fa fa-trash-o"></i>delete</a>
      <% } %>
    </td>
  """)

  templateContext :
    TemplateHelpers : TemplateHelpers

  events :
    "click .delete" : "delete"

  modelEvents :
    "change" : "render"


  delete : (evt) ->

    evt.preventDefault()
    if window.confirm("Do really want to delete this team?")
      @model.destroy()


module.exports = TeamListItemView
