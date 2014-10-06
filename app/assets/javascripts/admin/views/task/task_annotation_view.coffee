### define
underscore : _
moment : moment
libs/toast : Toast
backbone.marionette : marionette
admin/models/task/annotation_model : AnnotationModel
###

class TaskAnnotationView extends Backbone.Marionette.ItemView

  tagName : "tr"
  attributes : ->
    id : @model.get("id")

  template : _.template("""
    <td><%= user %></td>
    <td><%= moment(created).format("YYYY-MM-DD HH:SS") %></td>
    <td><i class="fa fa-check-circle-o"></i><%= stateLabel %></td>
    <td class="nowrap">
      <div class="btn-group">
        <a class="btn dropdown-toggle" data-toggle="dropdown" href="#">
          Actions
          <span class="caret"></span>
        </a>
        <ul class="dropdown-menu">
        <% _.each(actions, function(action){ %>
        <li>
          <a href="<%= action.call.url %>" class="<% if(action.isAjax){ %>isAjax<% } %>"><i class="<%= action.icon %>"></i><%= action.name %></a>
        </li>
        <% }) %>
        <li>
          <a href="#" class="delete-annotation"><i class="fa fa-trash-o"></i>delete</a>
        </li>
        </ul>
      </div>
    </td>
  """)

  templateHelpers :
    moment : moment

  events :
    "click .isAjax" : "callAjax"
    "click .delete-annotation" : "deleteAnnotation"


  # some actions are real links and some need to be send as ajax calls to the server
  callAjax : (evt) ->

    evt.preventDefault()
    $.ajax(
      url : $(evt.target).prop("href")
    ).done(
      (jsonData) =>
        if(jsonData)
          @model = new AnnotationModel(jsonData)
          @render()
    ).always(
      (response) ->
        if(response)
          message = response.messages
          Toast.message(message)
    )


  deleteAnnotation : ->

    if window.confirm("Do you really want to delete this annotation?")
      @model.destroy()
      @render()

