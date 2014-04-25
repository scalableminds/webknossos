### define
underscore : _
backbone.marionette : marionette
admin/models/dataset/dataset_collection : DatasetCollection
###

class SpotlightDatasetView extends Backbone.Marionette.ItemView

  template : _.template("""
    <div class="dataset panel panel-default">
      <div class="panel-body row">
        <div class="dataset-thumbnail col-sm-4">
          <a href="/datasets/<%= name %>/view">
            <img src="<%= thumbnailURL %>">
            <i class="fa fa-play"></i>
          </a>
        </div>
        <div class="dataset-description col-sm-8">
          <h3><%= owningTeam %></h3>
          <h4>Original data and segmentation</h4>
          <p><h4>Dataset: <%= name %></h4></p>
          <p><%= description || "" %></p>
        </div>
      </div>
    </div>
  """)
