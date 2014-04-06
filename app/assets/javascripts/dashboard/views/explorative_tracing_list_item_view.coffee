### define
underscore : _
backbone.marionette : marionette
routes : routes
libs/toast : Toast
###

class ExplorativeTracingListItemView extends Backbone.Marionette.ItemView

  tagName : "tr"
  template : _.template("""
    <td> <%= formattedHash %> </td>
    <td class="explorative-name-column hover-dynamic">
      <span class="hover-hide" id="explorative-tracing-name"> <%= name %> </span>
      <form action="<%= jsRoutes.controllers.AnnotationController.nameExplorativeAnnotation(typ, id).url %>"
        method="POST" class="hover-show" id="explorative-name-form" style="display: none">
        <div class="input-append">
          <input class="input-medium hover-input"
                 name="name"
                 id="explorative-name-input"
                 maxlength="50"
                 type="text"
                 value="<%= name %>"
                 autocomplete="off">
            <a href="#" id="explorative-name-submit" class="btn btn-default"><i class="fa fa-check"></i></a>
        </div>
      </form>
    </td>
    <td> <%= dataSetName %> </td>

    <td>
      <% if (stats) { %>
        <span title="Trees"><i class="fa fa-sitemap"></i><%= stats.numberOfTrees %> &nbsp;</span><br />
        <span title="Nodes"><i class="fa fa-bull"></i><%= stats.numberOfNodes %> &nbsp;</span><br />
        <span title="Edges"><i class="fa fa-arrows-h"></i><%= stats.numberOfEdges %></span>
      <% } %>
    </td>

    <td> <%= contentType + " - " + typ %> </td>
    <td> <%= created %> </td>
    <td class="nowrap">
      <a href="<%= jsRoutes.controllers.AnnotationController.trace(typ, id).url %>">
        <i class="fa fa-random"></i>
        trace
      </a><br />
      <a href="<%= jsRoutes.controllers.AnnotationController.download(typ, id).url %>">
        <i class="fa fa-download"></i>
        download
      </a><br />
      <% if (typ == "Explorational"){ %>
        <a href="<%= jsRoutes.controllers.AnnotationController.finish(typ, id).url %>"
           id="finish-tracing">
          <i class="fa fa-trash-o"></i>
          delete
        </a>
      <% } %>
    </td>
  """)

  events :
    "submit #explorative-name-form" : "nameExplorativeAnnotation"
    "click #finish-tracing" : "finishTracing"


  nameExplorativeAnnotation : (event) ->

    event.preventDefault()
    target = $(event.target)
    url = target.attr("action")

    $.ajax(
      url : url
      type: "post",
      data: target.serialize(),
    ).done((response) =>
      Toast.message(response.messages)
      newName = @$("input[name='name']").val()
      @model.set("name", newName)
      @render()
    ).fail((xhr) ->
      Toast.message(xhr.responseJSON.messages)
    )


  finishTracing : (event) ->

    event.preventDefault()
    url = $(event.target).attr("href")

    $.get(url).done((response) =>
      Toast.message(response.messages)
      @model.collection.remove(@model)
    ).fail((xhr) ->
      Toast.message(xhr.responseJSON.messages)
    )

