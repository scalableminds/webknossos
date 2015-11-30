### define
underscore : _
backbone.marionette : marionette
libs/template_helpers : TemplateHelpers
###

class TeamListItemView extends Backbone.Marionette.ItemView

  tagName : "tr"
  template : _.template("""
    <td><%= name %></td>
    <td><% if(parent){ %><%= parent %><% } %></td>
    <td><% if(owner){ %> <%= owner.firstName %> <%= owner.lastName %> <% }else{ %> - <% } %></td>
    <td>
      <% _.each(roles, function(role){ %>
          <span class="label label-default" style="background-color: <%= TemplateHelpers.stringToColor(role.name) %>"><%= role.name %></span>
      <% }) %>
    </td>
    </td>
    <td class="nowrap">
      <% if(amIOwner){ %>
        <a href="#" class="delete"><i class="fa fa-trash-o"></i>delete</a>
      <% } %>
    </td>
  """)

  templateHelpers :
    TemplateHelpers : TemplateHelpers

  events :
    "click .delete" : "delete"

  modelEvents :
    "change" : "render"


  delete : (evt) ->

    evt.preventDefault()
    if window.confirm("Do really want to delete this team?")
      @model.destroy()


