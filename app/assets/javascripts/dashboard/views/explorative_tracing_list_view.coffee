_                              = require("lodash")
Marionette                     = require("backbone.marionette")
app                            = require("app")
Input                          = require("libs/input")
Toast                          = require("libs/toast")
Request                        = require("libs/request")
SortTableBehavior              = require("libs/behaviors/sort_table_behavior")
ExplorativeTracingListItemView = require("./explorative_tracing_list_item_view")
UserAnnotationsCollection      = require("../models/user_annotations_collection")
DatasetCollection              = require("admin/models/dataset/dataset_collection")


class ExplorativeTracingListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Explorative Annotations</h3>
    <% if (!isAdminView) {%>
      <div>
        <form action="<%= jsRoutes.controllers.admin.NMLIO.upload().url %>"
          method="POST"
          enctype="multipart/form-data"
          id="upload-and-explore-form"
          class="form-inline inline-block">
          <div class="fileinput fileinput-new" data-provides="fileinput">
            <span class="btn btn-default btn-file">
              <span class="fileinput-new">
                <i class="fa fa-upload" id="form-upload-icon"></i>
                <i class="fa fa-spinner fa-spin hide" id="form-spinner-icon"></i>
                Upload NML & explore
              </span>
              <input type="file" name="nmlFile" multiple accept=".nml">
            </span>
          </div>
        </form>

        <div class="divider-vertical"></div>

        <a href="#" id="toggle-view-archived" class="btn btn-default">
          <%= toggleViewArchivedText() %>
        </a>
        <% if (showArchiveAllButton()) { %>
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
          <th data-sort="dataSource.id"> DataSet </th>
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
    "change input[type=file]" : "selectFiles"
    "submit @ui.uploadAndExploreForm" : "uploadFiles"
    "click @ui.toggleViewArchived" : "toggleViewArchived"
    "click @ui.archiveAllButton" : "archiveAll"

  ui :
    tracingChooser : "#tracing-chooser"
    uploadAndExploreForm : "#upload-and-explore-form"
    formSpinnerIcon : "#form-spinner-icon"
    formUploadIcon : "#form-upload-icon"
    toggleViewArchived : "#toggle-view-archived"
    archiveAllButton : "#archive-all"

  templateHelpers : ->
    isAdminView : @options.isAdminView
    showArchiveAllButton: =>
      !@showArchivedAnnotations
    toggleViewArchivedText: =>
      @toggleViewArchivedText()


  behaviors :
    SortTableBehavior :
      behaviorClass : SortTableBehavior


  initialize : (@options) ->

    @childViewOptions.parent = this

    @collection = new UserAnnotationsCollection([], userID : @options.userID)

    @showArchivedAnnotations = false
    @filter = @getFilterForState()

    @collection.fetch()


  getFilterForState: () ->

    if @showArchivedAnnotations
      @isArchived
    else
      @isNotArchived


  isArchived : (model) ->

    model.attributes.state.isFinished


  isNotArchived : (model) ->

    !model.attributes.state.isFinished


  selectFiles : (event) ->

    if event.target.files.length
      @ui.uploadAndExploreForm.submit()


  uploadFiles : (event) ->

    event.preventDefault()

    toggleIcon = (state) =>

      @ui.formSpinnerIcon.toggleClass("hide", state)
      @ui.formUploadIcon.toggleClass("hide", !state)


    toggleIcon(false)

    form = @ui.uploadAndExploreForm

    Request.always(
      Request.multipartForm(
        form.attr("action")
        data : new FormData(form[0])
      ).then((data) ->
        url = "/annotations/" + data.annotation.typ + "/" + data.annotation.id
        app.router.loadURL(url)
        Toast.message(data.messages)
      )
      -> toggleIcon(true)
    )


  setAllFinished: ->

    @collection.forEach((model) -> model.attributes.state.isFinished = true)


  archiveAll : () ->

    unarchivedAnnoationIds = @collection.pluck("id")
    $.ajax(
      url: jsRoutes.controllers.AnnotationController.finishAll("Explorational").url
      type: "POST",
      contentType: "application/json"
      data: JSON.stringify({
        annotations: unarchivedAnnoationIds
      })
    ).done( (data) =>
      Toast.message(data.messages)
      @setAllFinished()
      @render()
    ).fail( (xhr) ->
      if xhr.responseJSON
        Toast.message(xhr.responseJSON.messages)
      else
        Toast.message(xhr.statusText)
    )


  toggleState : ->

    @showArchivedAnnotations = not @showArchivedAnnotations


  toggleViewArchivedText : ->

    verb = if @showArchivedAnnotations then "open" else "archived"
    "Show #{verb} tracings "


  toggleViewArchived : (event) ->

    event.preventDefault()
    @toggleState()
    @filter = @getFilterForState()
    @render()


module.exports = ExplorativeTracingListView
