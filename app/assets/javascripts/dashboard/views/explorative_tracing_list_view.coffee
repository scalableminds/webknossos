### define
underscore : _
backbone.marionette : marionette
app : app
dashboard/views/explorative_tracing_list_item_view : ExplorativeTracingListItemView
###

class ExplorativeTracingListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Explorative Tracings</h3>
    <br />
    <% if (!this.isAdminView) {%>
      <div>
        <form action="<%= jsRoutes.controllers.admin.NMLIO.upload().url %>"
              method="POST"
              enctype="multipart/form-data"
              id="nml-explore-form"
              class="form-inline inline-block">
          <button type="submit" class="btn">
            <i class="fa fa-upload"></i>
            Upload NML & explore
          </button>
        </form>

        <div class="divider-vertical"></div>

        <form action="<%= jsRoutes.controllers.AnnotationController.createExplorational().url %>"
              method="POST"
              class="form-inline inline-block">
          <select name="dataSetName">
            <% _.each(dataSets, function(d) { %>
              <option value="<%= d.name %>"> <%= d.name %> </option>
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
    "click #new-task-button" : "newTask"

  isAdminView : false

  initialize : (options) ->


    @model = options.model

    @collection = @model.get("exploratory")

    window.test = @


  newTask : ->

    console.log("fetching new task")
