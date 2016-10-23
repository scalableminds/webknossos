_                              = require("lodash")
Marionette                     = require("backbone.marionette")
app                            = require("app")
Input                          = require("libs/input")
Toast                          = require("libs/toast")
Request                        = require("libs/request")
SortTableBehavior              = require("libs/behaviors/sort_table_behavior")
ExplorativeTracingListItemView = require("./explorative_tracing_list_item_view")
UserAnnotationsCollection      = require("../models/user_annotations_collection")


class ExplorativeTracingListView extends Marionette.CompositeView

  template : _.template("""
    <h3>Explorative Annotations</h3>
    <% if (!isAdminView) {%>
      <div>
        <form action="<%- jsRoutes.controllers.NMLIOController.upload().url %>"
          method="POST"
          enctype="multipart/form-data"
          id="upload-and-explore-form"
          class="form-inline inline-block">
          <div id="fileinput" class="fileinput fileinput-new" data-provides="fileinput">
            <span class="btn btn-default btn-file">
              <span>
                <i class="fa fa-upload fileinput-new" id="form-upload-icon"></i>
                <i class="fa fa-spinner fa-spin fileinput-exists" id="form-spinner-icon"></i>
                Upload NML & explore
              </span>
              <input type="file" name="nmlFile" multiple accept=".nml, .zip">
            </span>
          </div>
        </form>

        <div class="divider-vertical"></div>

        <% if (showArchivedAnnotations) { %>
        <a href="#" id="toggle-view-open" class="btn btn-default">
          <i class="fa fa-spinner fa-spin hide" id="toggle-view-spinner-icon"></i>
            Show open tracings
        </a>
        <% } else {%>
        <a href="#" id="toggle-view-archived" class="btn btn-default">
          <i class="fa fa-spinner fa-spin hide" id="toggle-view-spinner-icon"></i>
          Show archived tracings
        </a>
        <a href="#" id="archive-all" class="btn btn-default">
          Archive all
        </a>
        <% } %>
      </div>
    <% } %>

    <table class="table table-striped table-hover sortable-table" id="explorative-tasks">
      <thead>
        <tr>
          <th data-sort="formattedHash"> # </th>
          <th data-sort="name"> Name </th>
          <th data-sort="dataSetName"> DataSet </th>
          <th> Stats </th>
          <th> Type </th>
          <th data-sort="created"> Created </th>
          <th> </th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  """)

  childView : ExplorativeTracingListItemView
  childViewContainer : "tbody"
  childViewOptions:
    parent : null

  events :
    "change.bs.fileinput .fileinput" : "selectFiles"
    "submit @ui.uploadAndExploreForm" : "uploadFiles"
    "click @ui.toggleViewArchivedButton" : "fetchArchivedAnnotations"
    "click @ui.toggleViewOpenButton" : "fetchOpenAnnotations"
    "click @ui.archiveAllButton" : "archiveAll"

  ui :
    fileinput : "#fileinput"
    tracingChooser : "#tracing-chooser"
    uploadAndExploreForm : "#upload-and-explore-form"
    uploadFileInput : "#upload-and-explore-form input[type=file]"
    formSpinnerIcon : "#form-spinner-icon"
    formUploadIcon : "#form-upload-icon"
    toggleViewArchivedButton : "#toggle-view-archived"
    toggleViewOpenButton : "#toggle-view-open"
    toggleViewSpinner : "#toggle-view-spinner-icon"
    archiveAllButton : "#archive-all"

  templateContext : ->
    isAdminView : @options.isAdminView
    showArchivedAnnotations : @showArchivedAnnotations

  behaviors :
    SortTableBehavior :
      behaviorClass : SortTableBehavior


  initialize : (@options) ->

    @childViewOptions.parent = this
    @collection = new UserAnnotationsCollection([], userID : @options.userID)

    @showArchivedAnnotations = false
    @collection.fetch()


  selectFiles : (event) ->

    if @ui.uploadFileInput[0].files.length
      @ui.uploadAndExploreForm.submit()


  uploadFiles : (event) ->

    event.preventDefault()

    form = @ui.uploadAndExploreForm

    Request.sendMultipartFormReceiveJSON(
      form.attr("action")
      data : new FormData(form[0])
    ).then(
      (data) ->
        url = "/annotations/" + data.annotation.typ + "/" + data.annotation.id
        app.router.loadURL(url)
        Toast.message(data.messages)
      => @ui.fileinput.fileinput("clear")
    )


  archiveAll : () ->

    unless confirm("Are you sure you want to archive all explorative annotations?")
      return

    unarchivedAnnoationIds = @collection.pluck("id")
    Request.sendJSONReceiveJSON(
      jsRoutes.controllers.AnnotationController.finishAll("Explorational").url
      {
        method: "POST",
        data: {
          annotations: unarchivedAnnoationIds
        }
      }
    ).then(
      (data) =>
        Toast.message(data.messages)
        @collection.reset()
        @render()
    )

  fetchArchivedAnnotations : ->
    @ui.toggleViewSpinner.toggleClass("hide", false)
    @showArchivedAnnotations = true
    @collection.isFinished = true
    @collection.fetch().then(=> @render())

  fetchOpenAnnotations : ->
    @ui.toggleViewSpinner.toggleClass("hide", false)
    @showArchivedAnnotations = false
    @collection.isFinished = false
    @collection.fetch().then(=> @render())

  toggleViewArchivedText : ->

    verb = if @showArchivedAnnotations then "open" else "archived"
    "Show #{verb} tracings "


module.exports = ExplorativeTracingListView
