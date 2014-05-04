### define
backbone.marionette : marionette
###

class DatasetAccessView extends Backbone.Marionette.ItemView

  tagName : "tr"

  template : _.template("""
    <td><%= firstName %> <%= lastName %></td>
    <td>
      <% teams.forEach(function(team){ %>
        <span class="label label-default"><%= team.team %></span>
      <% }) %>
    </td>
  """)
