_              = require("lodash")
marionette     = require("backbone.marionette")
app            = require("app")
Toast          = require("libs/toast")
MergeModalView = require("./merge_modal_view")
ShareModalView = require("./share_modal_view")
Constants      = require("oxalis/constants")

class DatasetActionsView extends Backbone.Marionette.ItemView

  template : _.template("""
    <% if(tracing.restrictions.allowUpdate){ %>
      <a href="#" class="btn btn-primary" id="trace-save-button">Save</a>
    <% } else { %>
      <button class="btn btn-primary disabled">Read only</button>
    <% } %>
    <div class="btn-group btn-group">
      <% if(tracing.restrictions.allowFinish) { %>
        <a href="/annotations/<%= tracingType %>/<%= tracingId %>/finishAndRedirect" class="btn btn-default" id="trace-finish-button"><i class="fa fa-check-circle-o"></i>Archive</a>
      <% } %>
      <% if(tracing.restrictions.allowDownload || ! tracing.downloadUrl) { %>
        <a class="btn btn-default" id="trace-download-button"><i class="fa fa-download"></i>Download</a>
      <% } %>
      <button class="btn btn-default" id="trace-share-button"><i class="fa fa-share-alt"></i>Share</button>
      <a href="#help-modal" class="btn btn-default" data-toggle="modal"><i class="fa fa-question-circle"></i>Help</a>
    </div>

    <div id="help-modal" class="modal fade">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal">×</button>
            <h3>Keyboard Shortcuts</h3>
          </div>
          <div class="modal-body" id="help-modal-body">
            <table class="table table-striped table-hover">
              <thead>
                <tr>
                  <th>Key binding</th>
                  <th>Action</th>
                </tr>
              </thead>
              <% if (isSkeletonMode) { %>
                <tbody>
                  <tr><td>Left Mouse drag or Arrow keys</td><td>Move</td></tr>
                  <tr><td>I, O or Alt + Mousewheel</td><td>Zoom in/out</td></tr>
                  <tr><td>F, D or Mousewheel</td><td>Move along Z-Axis</td></tr>
                  <tr><td>Right click</td><td>Set node</td></tr>
                  <tr><td>Shift + Alt + Left click</td><td>Merge two trees</td></tr>
                  <tr><td>K, L</td><td>Scale up/down viewport size</td></tr>
                  <tr><td>B, J</td><td>Set/Jump to last branchpoint</td></tr>
                  <tr><td>S</td><td>Center active node</td></tr>
                </tbody>
              <% } else { %>
                <tbody class="volume-controls">
                  <tr><td>Left click</td><td>Set active cell</td></tr>
                  <tr><td>Left Mouse drag</td><td>Move (Move mode) / Add to current Cell (Trace mode)</td></tr>
                  <tr><td>Arrow keys</td><td>Move</td></tr>
                  <tr><td>Shift + Left Mouse drag / Right Mouse drag</td><td>Remove voxels from cell</td></tr>
                  <tr><td>C</td><td>Create new cell</td></tr>
                  <tr><td>M</td><td>Toggle Move / Trace mode</td></tr>
                </tbody>
              <% } %>
            </table>
            <p>For a full list of all keyboard shortcuts <a target="_blank" href="/help/keyboardshortcuts">see the help section.</a></p>
            <p>We encourage you to read the <a target="_blank" href="/help/faq">tutorials</a> to completely understand how webKnossos works.</p>
            <p>Introductory  <a target="_blank" href="http://to.do">videos</a> are available.</p>
          </div>
          <div class="modal-footer">
            <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
          </div>
        </div>
      </div>
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
    @saveTracing()
    if confirm("Are you sure you want to permanently finish this tracing?")
      window.location.href = evt.currentTarget.href


  downloadTracing : (evt) ->

    evt.preventDefault()
    @saveTracing()
    window.location.href = @model.tracing.downloadUrl


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
