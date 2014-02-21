### define
underscore : _
moment : moment
backbone.marionette : marionette
###

class TaskSubListItemView extends Backbone.Marionette.ItemView

  tagName : "tr"
  attributes : ->
    id : @model.get("id")

  template : _.template("""
    <td><%= user %></td>
    <td><%= moment(lastEdit).format("YYYY-MM-DD HH:SS") %></td>
    <td><i class="icon-ok-circle"></i><%= stateLabel %></td>
    <td class="nowrap">
      <div class="btn-group">
        <a class="btn dropdown-toggle" data-toggle="dropdown" href="#">
          Actions
          <span class="caret"></span>
        </a>
        <ul class="dropdown-menu">
        <% _.each(actions, function(action){ %>
        <li>
          <a href="<%= action.call.url %>"><i class="<%= action.icon %>"></i><%= action.name %></a>
        </li>
        <% }) %>
        </ul>
      </div>
    </td>
  """)

  templateHelpers :
    moment : moment

  events :
    "click .delete" : "delete"


