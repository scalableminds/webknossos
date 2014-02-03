### define
underscore : _
backbone.marionette : marionette
###

class UserListItemView extends Backbone.Marionette.ItemView

  tagName : "tr"
  attributes : ->
    "data-name" : "#{@model.get("firstName")} #{@model.get("lastName")}"
    "data-id" : @model.get("id")
    "id" : @model.get("id")

  template : _.template("""
    <td><input type="checkbox" name="id" value="<%= id %>" class="select-row"></td>
    <td><%= lastName %></td>
    <td><%= firstName %></td>
    <td><%= email %></td>
    <td>
      <% _.each(experiences, function(experience){ %>
        <span class="label label-experience"><%= experience._1 %> <%= experience._2 %></span>
      <% }) %>
    </td>
    <td>
      <% _.each(teams, function(team){ %>
        <%= team.team %>
        <span class="label" style="background-color:rgba(
          <%= Math.round(team.role.color[0] * 255) %>,
          <%= Math.round(team.role.color[1] * 255) %>,
          <%= Math.round(team.role.color[2] * 255) %>,
          <%= Math.round(team.role.color[3] * 255) %>
        )"><%= team.role.name %></span><br/>
      <% }) %>
    </td>
    <td>
      <% if(verified) { %>
        <i class="icon-ok"></i>
      <% } else { %>
        <a href="#" class="show-modal" data-title="Assign to a Team" data-template="teampicker"> verify </a>
      <% } %>
    </td>
    <td class="nowrap">
      <a href="/users/<%= id %>/details"><i class="icon-user"></i> show Tracings</a><br />
      <a href="/api/users/<%= id %>/annotations/download" title="download all finished tracings"><i class="icon-download"></i> download </a><br />
      <a href="#"><i class="icon-trash"></i> delete </a><br />
      <!--<a href="/admin/users/<%= id %>/loginAs"><i class="icon-signin"></i> log in as User </a>-->
    </td>
  """)

  events : ->
    "click a[href=#]" : "delete"


  delete : ->

    @model.destroy()
