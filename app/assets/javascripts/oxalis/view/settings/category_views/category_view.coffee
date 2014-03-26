### define
backbone.marionette : marionette
backbone.subviews : subviews
underscore : _
###

class CategoryView extends Backbone.Marionette.ItemView

  # TODO: remove accordion* classes after bootstrap 3 update

  template : _.template("""
    <div class="panel panel-default accordion-group">
      <div class="panel-heading accordion-heading">
        <a class="panel-title accordion-toggle" data-toggle="collapse" data-parent="#user-settings" href="#user-settings-<%= tabId %>">
          <%= caption %>
        </a>
      </div>
      <div id="user-settings-<%= tabId %>" class="panel-collapse accordion-body collapse in">
        <div class="panel-body accordion-inner">

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
