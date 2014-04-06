### define
underscore : _
backbone.marionette : marionette
app : app
dashboard/views/explorative_tracing_list_item_view : ExplorativeTracingListItemView
admin/models/dataset/dataset_collection : DatasetCollection
libs/input : Input
libs/toast : Toast
###

class ExplorativeTracingListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Explorative Tracings</h3>
    <% if (!isAdminView) {%>
      <div>
        <form action="<%= jsRoutes.controllers.admin.NMLIO.upload().url %>"
              method="POST"
              enctype="multipart/form-data"
              id="upload-and-explore-form"
              class="form-inline inline-block">
            <span class="btn-file btn">
              <input type="file" name="nmlFile" multiple>
                <i class="fa fa-upload" id="form-upload-icon"></i>
                <i class="fa fa-spinner fa-spin hide" id="form-spinner-icon"></i>
                Upload NML & explore
              </input>
            </span>
        </form>

        <div class="divider-vertical"></div>

        <form action="<%= jsRoutes.controllers.AnnotationController.createExplorational().url %>"
              method="POST"
              class="form-inline inline-block">
          <select name="dataSetName">
            <% dataSets.forEach(function(d) { %>
              <option value="<%= d.get("name") %>"> <%= d.get("name") %> </option>
            <% }) %>
          </select>
          <span id="tracing-chooser">
            <label class="radio inline">
              <input type="radio" name="contentType" value="skeletonTracing" checked>
              Skeleton
            </label>
            <label class="radio inline">
              <input type="radio" name="contentType" value="volumeTracing">
              Volume
            </label>
          </span>
          <button type="submit" class="btn"><i class="fa fa-search"></i>Explore data set</button>
        </form>
      </div>
    <% } %>

    <table class="table table-striped table-hover" id="explorative-tasks">
      <thead>
        <tr>
          <th> # </th>
          <th> Name </th>
          <th> DataSet </th>
          <th> SkeletonTracing Stats </th>
          <th> SkeletonTracing-Type </th>
          <th> Last edited </th>
          <th> </th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  """)

  itemView : ExplorativeTracingListItemView
  itemViewContainer : "tbody"

  events :
    "change input[type=file]" : "selectFiles"
    "submit @ui.uploadAndExploreForm" : "uploadFiles"

  ui :
    tracingChooser : "#tracing-chooser"
    uploadAndExploreForm : "#upload-and-explore-form"
    formSpinnerIcon : "#form-spinner-icon"
    formUploadIcon : "#form-upload-icon"


  initialize : (options) ->

    @model.set("isAdminView", options.isAdminView)
    @collection = @model.get("exploratoryAnnotations")

    datasetCollection = new DatasetCollection()
    @model.set("dataSets", datasetCollection)

    @listenTo(datasetCollection, "sync", @render)
    datasetCollection.fetch(silent : true)


  onShow : ->

    @tracingChooserToggler = new Input.KeyboardNoLoop(
      "v" : => @ui.tracingChooser.toggleClass("hide")
    )


  selectFiles : (event) ->

    if event.target.files.length
      @ui.uploadAndExploreForm.submit()


  uploadFiles : (event) ->

    event.preventDefault()

    toggleIcon = =>

      [@ui.formSpinnerIcon, @ui.formUploadIcon].forEach((ea) -> ea.toggleClass("hide"))


    toggleIcon()

    form = @ui.uploadAndExploreForm

    $.ajax(
      url : form.attr("action")
      data : new FormData(form[0])
      type : "POST"
      processData : false
      contentType : false
    ).done( (data) ->
      url = "/annotations/" + data.annotation.typ + "/" + data.annotation.id
      app.router.loadURL(url)
      Toast.message(data.messages)
    ).fail( (xhr) ->
      Toast.message(xhr.responseJSON.messages)
    ).always( ->
      toggleIcon()
    )


  onClose : ->

    @tracingChooserToggler.unbind()
