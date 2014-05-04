### define
backbone.marionette : marionette
libs/template_helpers : TemplateHelpers
###

class DatasetAccessView extends Backbone.Marionette.ItemView

  tagName : "tr"

  template : _.template("""
    <td><%= firstName %> <%= lastName %></td>
    <td>
      <% teams.forEach(function(team){ %>
        <span class="label label-default" style="background-color: <%= TemplateHelpers.stringToColor(team.team) %>"><%= team.team %></span>
      <% }) %>
    </td>
  """)

  templateHelpers :
    TemplateHelpers : TemplateHelpers
