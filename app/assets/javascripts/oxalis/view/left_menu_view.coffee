### define
backbone.marionette : marionette
./left-menu/dataset_actions_view : DatasetActionsView
./left-menu/dataset_info_view : DatasetInfoView
###

class LeftMenuView extends Backbone.Marionette.Layout

  template : _.template("""
    <div id="dataset-actions" class="row"></div

    <div class="input-group">
      <span class="input-group-addon">Position</span>
      <input id="trace-position-input" class="form-control" type="text">
    </div>
    <div class="input-group" id="trace-rotation">
      <span class="input-group-addon">Rotation</span>
      <input id="trace-rotation-input" class="form-control" type="text">
    </div>

    <div id="dataset-info"></div>


    <div id="volume-actions" class="volume-controls">
      <button class="btn btn-default" id="btn-merge">Merge cells</button>
    </div>

    <div id="view-mode" class="skeleton-controls">
      <p>View mode:</p>
      <div class="btn-group">
        <button type="button" class="btn btn-default btn-primary" id="view-mode-3planes">3 Planes</button>
        <button type="button" class="btn btn-default" id="view-mode-sphere">Sphere</button>
        <button type="button" class="btn btn-default" id="view-mode-arbitraryplane">Arbitrary Plane</button>
      </div>
    </div>

    <div id="lefttabbar">
        <ul class="nav nav-tabs">

          @if(additionalHtml.body != ""){
            <div class="tab-pane active" id="tab1">
              <div id="review-comments">
                @additionalHtml
              </div>
            </div>
            <div class="tab-pane" id="tab2" />
          } else {
            <div class="tab-pane active" id="tab2" />
          }
            <div id="status"></div>
            <div id="optionswindow"></div>
          </div>
        </div>

    </div>
  """)

  regions :
    "datasetActionButtons" : "#dataset-actions"
    "datasetInfo" : "#dataset-info"

  initialize : (options) ->

    @datasetActionsView = new DatasetActionsView(options)
    @datasetInfoView = new DatasetInfoView(options)
    @listenTo(@, "render", @afterRender)


  afterRender : ->

    @datasetActionButtons.show(@datasetActionsView)
    @datasetInfo.show(@datasetInfoView)





  #   <% if(task) { %>
  #     <li><a href="#tab0" data-toggle="tab">Task</a></li>
  #   <% } %>
  #   @if(additionalHtml.body != ""){
  #     <li class="active"><a href="#tab1" data-toggle="tab">Review</a></li>
  #     <li>
  #   } else {
  #     <li class="active">
  #   }
  #   <a href="#tab2" data-toggle="tab">Options</a></li>
  # </ul>
  #
  # <div class="tab-content">
  #   <% if(task) { %>
  #     <div class="tab-pane" id="tab0">
  #       <h5><%=task.type.summary%></h5>
  #       <%=task.type.description%>
  #     </div>
  #   <% } %>
