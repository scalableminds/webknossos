_              = require("lodash")
Marionette     = require("backbone.marionette")
app            = require("app")
Toast          = require("libs/toast")
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
        <a href="/annotations/<%- tracingType %>/<%- tracingId %>/finishAndRedirect" class="btn btn-default" id="trace-finish-button"><i class="fa fa-check-circle-o"></i>Archive</a>
      <% } %>
      <% if(tracing.restrictions.allowDownload || ! tracing.downloadUrl) { %>
        <a class="btn btn-default" id="trace-download-button"><i class="fa fa-download"></i>Download</a>
      <% } %>
      <button class="btn btn-default" id="trace-share-button"><i class="fa fa-share-alt"></i>Share</button>
    </div>

    <% if (isSkeletonMode) { %>
      <div class="btn btn-default" id="trace-merge-button"><i class="fa fa-folder-open"></i>Merge Tracing</div>
      <div class="merge-modal-wrapper"></div>
    <% } %>
  """)

  templateHelpers : ->

    isSkeletonMode : @isSkeletonMode()

  events :
    "click #trace-finish-button" : "finishTracing"
    "click #trace-download-button" : "downloadTracing"
    "click #trace-save-button" : "saveTracing"
    "click #trace-merge-button" : "mergeTracing"
    "click #trace-share-button" : "shareTracing"

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
      model.stateLogger.pushImpl()

      modalView = new ShareModalView({@model})
      @ui.modalWrapper.html(modalView.render().el)
      modalView.show()


  isSkeletonMode : ->

    return _.contains(Constants.MODES_SKELETON, @model.get("mode"))

module.exports = DatasetActionsView
