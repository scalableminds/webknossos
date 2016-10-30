_               = require("lodash")
moment          = require("moment")
Toast           = require("libs/toast")
Request         = require("libs/request")
Marionette      = require("backbone.marionette")
AnnotationModel = require("admin/models/task/annotation_model")

class TaskAnnotationView extends Marionette.View

  tagName : "tr"
  attributes : ->
    id : @model.get("id")

  template : _.template("""
    <td><%- user.firstName %> <%- user.lastName %> (<%- user.email %>)</td>
    <td><%- moment(created).format("YYYY-MM-DD HH:SS") %></td>
    <td><i class="fa fa-check-circle-o"></i><%- stateLabel %></td>
    <td class="nowrap">
      <div class="btn-group">
        <a class="btn dropdown-toggle" data-toggle="dropdown" href="#">
          Actions
          <span class="caret"></span>
        </a>
        <ul class="dropdown-menu">
        <% _.each(actions, function(action){ %>
        <li>
          <a href="<%- action.call.url %>" class="<% if(action.isAjax){ %>isAjax<% } %>"><i class="<%- action.icon %>"></i><%- action.name %></a>
        </li>
        <% }) %>
        <li>
          <a href="#" class="cancel-annotation"><i class="fa fa-trash-o"></i>cancel</a>
        </li>
        </ul>
      </div>
    </td>
  """)

  templateContext :
    moment : moment

  events :
    "click .isAjax" : "callAjax"
    "click .cancel-annotation" : "cancelAnnotation"

  modelEvents :
    "change" : "render"


  # some actions are real links and some need to be send as ajax calls to the server
  callAjax : (evt) ->

    evt.preventDefault()

    Request.receiveJSON($(evt.target).prop("href")).then( (jsonData) =>
      @model.set(jsonData)
      message = jsonData.messages
      Toast.message(message)
    )


  cancelAnnotation : ->

    if window.confirm("Do you really want to cancel this annotation?")
      @model.destroy()

module.exports = TaskAnnotationView
