_              = require("lodash")
Marionette     = require("backbone.marionette")
app            = require("app")
Toast          = require("libs/toast")
Request        = require("libs/request")
MergeModalView = require("./merge_modal_view")
ShareModalView = require("./share_modal_view")
Constants      = require("oxalis/constants")

class DatasetActionsView extends Marionette.ItemView

  template : _.template("""
    <% if(tracing.restrictions.allowUpdate){ %>
      <a href="#" class="btn btn-primary" id="trace-save-button">Save</a>
    <% } else { %>
      <button class="btn btn-primary disabled">Read only</button>
    <% } %>
    <div class="btn-group btn-group">
      <% if(tracing.restrictions.allowFinish) { %>
        <a href="/annotations/<%- tracingType %>/<%- tracingId %>/finishAndRedirect" class="btn btn-default" id="trace-finish-button"><i class="fa fa-check-circle-o"></i><%- getArchiveBtnText() %></a>
      <% } %>
      <% if(tracing.restrictions.allowDownload || ! tracing.downloadUrl) { %>
        <a class="btn btn-default" id="trace-download-button"><i class="fa fa-download"></i>Download</a>
      <% } %>
      <button class="btn btn-default" id="trace-share-button"><i class="fa fa-share-alt"></i>Share</button>
    </div>

    <% if(tracing.restrictions.allowFinish && tracing.task) { %>
        <button class="btn btn-default" id="trace-next-task-button"><i class="fa fa-step-forward"></i>Finish and Get Next Task</button>
    <% } %>

    <% if (isSkeletonMode) { %>
      <div class="btn btn-default" id="trace-merge-button"><i class="fa fa-folder-open"></i>Merge Tracing</div>
      <div class="merge-modal-wrapper"></div>
    <% } %>
  """)

  templateHelpers : ->

    isSkeletonMode : @isSkeletonMode()
    getArchiveBtnText : -> return if @isTask then "Finish" else "Archive"


  events :
    "click #trace-finish-button" : "finishTracing"
    "click #trace-download-button" : "downloadTracing"
    "click #trace-save-button" : "saveTracing"
    "click #trace-merge-button" : "mergeTracing"
    "click #trace-share-button" : "shareTracing"
    "click #trace-next-task-button" : "getNextTask"

  ui :
    "modalWrapper" : ".merge-modal-wrapper"


  finishTracing : (evt) ->

    evt.preventDefault()
    @saveTracing().then( =>
      if confirm("Are you sure you want to permanently finish this tracing?")
        app.router.loadURL(evt.currentTarget.href)
    )


  downloadTracing : (evt) ->

    evt.preventDefault()
    @saveTracing().then( =>
      window.open(@model.tracing.downloadUrl, "_blank")
    )


  saveTracing : (evt) ->

    if evt
      evt.preventDefault()

    return @model.save()


  mergeTracing : ->

    modalView = new MergeModalView({@model})
    @ui.modalWrapper.html(modalView.render().el)
    modalView.show()


  shareTracing : ->

      # save the progress
      model = @model.skeletonTracing || @model.volumeTracing
      model.stateLogger.save()

      modalView = new ShareModalView({@model})
      @ui.modalWrapper.html(modalView.render().el)
      modalView.show()


  isSkeletonMode : ->

    return _.includes(Constants.MODES_SKELETON, @model.get("mode"))


  getNextTask : ->

    model = @model.skeletonTracing || @model.volumeTracing
    finishUrl = "/annotations/#{@model.tracingType}/#{@model.tracingId}/finish"
    requestTaskUrl = "/user/tasks/request"

    model.stateLogger.save()
        .then(=> Request.triggerRequest(finishUrl))
        .then(=>
          Request.receiveJSON(requestTaskUrl).then(
            (annotation) =>
              differentTaskType = annotation.task.type.id != @model.tracing.task?.type.id
              differentTaskTypeParam = if differentTaskType then "?differentTaskType" else ""
              newTaskUrl = "/annotations/#{annotation.typ}/#{annotation.id}#{differentTaskTypeParam}"
              app.router.loadURL(newTaskUrl)
            ->
              # Wait a while so users have a chance to read the error message
              setTimeout((-> app.router.loadURL("/dashboard")), 2000)
          )
        )

module.exports = DatasetActionsView
