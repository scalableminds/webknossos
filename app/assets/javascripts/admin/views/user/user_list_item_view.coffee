### define
underscore : _
backbone.marionette : marionette
admin/views/user/team_role_modal_view : TeamRoleModalView
libs/template_helpers : TemplateHelpers
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
      <% _.each(experiences, function(value, domain){ %>
        <span class="label label-experience"><%= domain %> : <%= value %></span>
      <% }) %>
    </td>
    <td>
      <% _.each(teams, function(team){ %>
        <%= team.team %>
        <span class="label" style="background-color: <%= TemplateHelpers.roleToColor(team.role.name) %>"><%= team.role.name %></span><br/>
      <% }) %>
    </td>
    <td>
      <% if(verified) { %>
        <i class="icon-ok"></i>
      <% } else { %>
        <a href="#" class="verify-user"> verify </a>
      <% } %>
    </td>
    <td class="nowrap">
      <a href="/users/<%= id %>/details"><i class="icon-user"></i> show Tracings</a><br />
      <a href="/api/users/<%= id %>/annotations/download" title="download all finished tracings"><i class="icon-download"></i> download </a><br />
      <a href="#"><i class="icon-trash"></i> delete </a><br />
      <!--<a href="/admin/users/<%= id %>/loginAs"><i class="icon-signin"></i> log in as User </a>-->
    </td>
  """, null, {imports: {TemplateHelpers}})

  events :
    "click .delete-user" : "delete"
    "click .verify-user" : "verify"

  modelEvents :
    "change" : "render"


  delete : ->

    @model.destroy()


  verify : ->

    #select checkbox, so that it gets picked up by the bulk verification modal
    @$el.find("input").prop("checked", true)

    #HACKY
    $("#team-role-modal").click()

