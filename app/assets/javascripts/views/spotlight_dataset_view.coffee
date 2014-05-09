### define
underscore : _
backbone.marionette : marionette
admin/models/dataset/dataset_collection : DatasetCollection
###

class SpotlightDatasetView extends Backbone.Marionette.ItemView

  className : "dataset panel panel-default"

  template : _.template("""
    <div class="panel-body row">
      <div class="dataset-thumbnail col-sm-4">
        <img class="img-rounded" src="<%= thumbnailURL %>">

        <div class="link-row">
          <a href="/datasets/<%= name %>/view" title="View tracing">
            <img src="assets/images/eye.svg">
          </a>
          <a href="/datasets/<%= name %>/skeletonTracing" title="Create skeleton tracing">
            <img src="assets/images/skeleton.svg">
          </a>
          <a href="/datasets/<%= name %>/volumeTracing" title="Create volume tracing">
            <img src="assets/images/volume.svg">
          </a>
        </div>
      </div>
      <div class="dataset-description col-sm-8">
        <h3><%= owningTeam %></h3>
        <h4>Original data and segmentation</h4>
        <p><h4>Dataset: <%= name %></h4></p>
        <p><%= description %></p>
      </div>
    </div>
  """)


  onShow: ->

    @$(".link-row > a").tooltip(placement : "bottom")

