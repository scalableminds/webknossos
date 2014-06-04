### define
backbone.marionette : marionette
backbone.subviews : subviews
underscore : _
###

class CategoryView extends Backbone.Marionette.ItemView


  template : _.template("""
    <div class="panel panel-default">
      <div class="panel-heading" data-toggle="collapse" data-parent="#user-settings" href="#user-settings-<%= tabId %>">
        <h4 class="panel-title">
          <a><%= caption %></a>
        </h4>
      </div>
      <div id="user-settings-<%= tabId %>" class="panel-collapse collapse in">
        <div class="panel-body">

          <% _.forEach(subviewCreators, function (subview, key) { %>
            <div data-subview="<%= key %>"></div>
          <% }) %>

        </div>
      </div>
    </div>
  """)


  initialize : ->

    Backbone.Subviews.add(this)


  serializeData : ->

    return { @subviewCreators, @caption, tabId : _.uniqueId() }
