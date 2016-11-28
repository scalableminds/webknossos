_                 = require("lodash")
Marionette        = require("backbone.marionette")
TeamRoleModalView = require("admin/views/user/team_role_modal_view")
TemplateHelpers   = require("libs/template_helpers")

class UserListItemView extends Marionette.View

  tagName : "tr"
  attributes : ->
    "data-name" : "#{@model.get("firstName")} #{@model.get("lastName")}"
    "data-id" : @model.get("id")
    "id" : @model.get("id")

  template : _.template("""
    <td>
      <input type="checkbox" name="id" value="<%- id %>" class="select-row">
    </td>
    <td><%- lastName %></td>
    <td><%- firstName %></td>
    <td><%- email %></td>
    <td>
      <% _.each(experiences, function(value, domain){ %>
        <span class="label label-default"><%- domain %> : <%- value %></span>
      <% }) %>
    </td>
    <td class="no-wrap">
      <% _.each(teams, function(team){ %>
        <%- team.team %>
        <span class="label label-default" style="background-color: <%- TemplateHelpers.stringToColor(team.role.name) %>"><%- team.role.name %></span><br/>
      <% }) %>
    </td>
    <td>
      <% if(isActive) { %>
        <i class="fa fa-check fa-2x"></i><br />
        <a href="#" class="deactivate-user">deactivate</a>
      <% } else { %>
        <i class="fa fa-remove fa-2x"></i><br />
        <a href="#" class="activate-user">activate</a>
      <% } %>
    </td>
    <td class="nowrap">
      <a href="/users/<%- id %>/details"><i class="fa fa-user"></i>show Tracings</a><br />
      <a href="/api/users/<%- id %>/annotations/download" title="download all finished tracings"><i class="fa fa-download"></i>download </a><br />
      <!--<a href="/admin/users/<%- id %>/loginAs"><i class="fa fa-signin"></i>log in as User </a>-->
    </td>
  """)

  templateContext :
    TemplateHelpers : TemplateHelpers

  events :
    "click .activate-user" : "activate"
    "click .deactivate-user" : "deactivate"

  modelEvents :
    "change" : "render"

  activate : ->

    #select checkbox, so that it gets picked up by the bulk verification modal
    @$("input").prop("checked", true)

    #HACKY
    $("#team-role-modal").click()

  deactivate : ->
    if window.confirm("Do you really want to deactivate this user?")
      #select checkbox, so that it gets picked up by the bulk verification modal
      @$("input").prop("checked", true)

      # TODO: deactivate user

module.exports = UserListItemView
