### define
underscore : _
backbone.marionette : marionette
libs/template_helpers : TemplateHelpers
###

class TeamListItemView extends Backbone.Marionette.ItemView

  tagName : "tr"
  template : _.template("""
    <td><input type="checkbox" name="name" value="<%= name %>" class="select-row"></td>
    <td><%= name %></td>
    <td><%= owner %></td>
    <td>
      <% _.each(roles, function(role){ %>
          <span class="label" style="background-color: <%= TemplateHelpers.roleToColor(role.name) %>"><%= role.name %></span>
      <% }) %>
    </td>
    </td>
    <td class="nowrap">
      <a href="#" class="delete"><i class="fa fa-trash-o"></i>delete</a>
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
    @model.destroy()


