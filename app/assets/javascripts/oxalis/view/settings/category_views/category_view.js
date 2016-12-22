_          = require("lodash")
Marionette = require("backbone.marionette")
Subviews   = require("backbone-subviews")

class CategoryView extends Marionette.View
  # Abstract class to create category views. Subclasses must specify
  # `subviewCreatorsList` like so:
  #
  # subviewCreatorsList: [
  #   [
  #     "unique_view_id", ->
  #       # Create & return subview
  #   ]
  # ]

  template : _.template("""
    <div class="panel panel-default">
      <div class="panel-heading" data-toggle="collapse" data-target="#user-settings-<%- tabId %>">
        <h4 class="panel-title">
          <a>
            <i class="caret-down"></i>
            <i class="caret-right"></i>
            <%- caption %>
          </a>
        </h4>
      </div>
      <div id="user-settings-<%- tabId %>" class="panel-collapse collapse in">
        <div class="panel-body">

          <% _.forEach(subviewCreatorsList, function (key_value_pair) { %>
            <div data-subview="<%- key_value_pair[0] %>"></div>
          <% }) %>

        </div>
      </div>
    </div>
  """)


  initialize : ->

    unless @subviewCreatorsList?
      throw new Error(
        "Subclasses of CategoryView must specify subviewCreatorsList")

    # subviewCreators hash needed for Subviews extension
    @subviewCreators = _.transform(
      @subviewCreatorsList
      (result, [key, value]) -> result[key] = value
      {}
    )

    Subviews.add(this)


  serializeData : ->

    return { @subviewCreatorsList, @caption, tabId : _.uniqueId() }


  hide : ->

    @$el.hide()


  show : ->

    @$el.show()

module.exports = CategoryView
