_             = require("lodash")
Marionette    = require("backbone.marionette")
routes        = require("routes")
Toast         = require("libs/toast")
HoverShowHide = require("libs/behaviors/hover_show_hide_behavior")
Toast         = require("libs/toast")
Request       = require("libs/request")

class ExplorativeTracingListItemView extends Marionette.View

  tagName : "tr"
  template : _.template("""
    <td>
      <div class="monospace-id">
        <%- id %>
      </div>
    </td>
    <td class="explorative-name-column hover-dynamic">
      <span class="hover-hide" id="explorative-tracing-name"><%- name %></span>
      <form action="<%- jsRoutes.controllers.AnnotationController.nameExplorativeAnnotation(typ, id).url %>"
        method="POST" class="hover-show hide" id="explorative-name-form">
        <div class="input-append">
          <input class="input-medium hover-input form-control"
                 name="name"
                 id="explorative-name-input"
                 maxlength="50"
                 type="text"
                 value="<%- name %>"
                 autocomplete="off">
        </div>
      </form>
    </td>
    <td><%- dataSetName %></td>

    <td class="nowrap">
      <% if (stats && (contentType == "skeletonTracing")) { %>
        <span title="Trees"><i class="fa fa-sitemap"></i><%- stats.numberOfTrees %>&nbsp;</span><br />
        <span title="Nodes"><i class="fa fa-bull"></i><%- stats.numberOfNodes %>&nbsp;</span><br />
        <span title="Edges"><i class="fa fa-arrows-h"></i><%- stats.numberOfEdges %></span>
      <% } %>
    </td>

    <td><%- contentType + " - " + typ %></td>
    <td><%- created %></td>
    <td class="nowrap">
      <% if (typ == "Explorational"){ %>
        <% if (!state.isFinished) {%>
          <a href="<%- jsRoutes.controllers.AnnotationController.trace(typ, id).url %>">
            <i class="fa fa-random"></i>
            <strong>trace</strong>
          </a><br />
          <a href="<%- jsRoutes.controllers.AnnotationController.download(typ, id).url %>">
            <i class="fa fa-download"></i>
            download
          </a><br />
          <a href="<%- jsRoutes.controllers.AnnotationController.finish(typ, id).url %>"
             id="finish-tracing">
            <i class="fa fa-archive"></i>
            archive
          </a><br />
        <% } else {%>
          <a href="<%- jsRoutes.controllers.AnnotationController.reopen(typ, id).url %>"
             id="reopen-tracing">
            <i class="fa fa-folder-open"></i>
            reopen
          </a><br />
        <% } %>
      <% } %>
    </td>
  """)

  events :
    "submit #explorative-name-form" : "nameExplorativeAnnotation"
    "click #finish-tracing" : "finishOrOpenTracing"
    "click #reopen-tracing" : "finishOrOpenTracing"
    "change @ui.explorativeNameInput" : "submitForm"

  ui :
    "explorativeNameForm" : "#explorative-name-form"
    "explorativeNameInput": "#explorative-name-input"

  behaviors :
    HoverShowHide :
      behaviorClass : HoverShowHide


  submitForm: ->

    @ui.explorativeNameForm.submit()


  nameExplorativeAnnotation : (event) ->

    event.preventDefault()
    target = $(event.target)
    url = target.attr("action")

    Request.sendUrlEncodedFormReceiveJSON(
      url
      data: target
    ).then( (response) =>
      Toast.message(response.messages)
      newName = @$("input[name='name']").val()
      @model.set("name", newName)
      @render()
    )

  toggleState: (state) ->
    state.isFinished = !state.isFinished


  finishOrOpenTracing : (event) ->

    event.preventDefault()
    url = $(event.target).attr("href") || $(event.target.parentElement).attr("href")

    Request.receiveJSON(url).then( (response) =>
      Toast.message(response.messages)
      @toggleState(@model.attributes.state)
      @model.collection.remove(@model)
      @options.parent.render()
    )

module.exports = ExplorativeTracingListItemView
