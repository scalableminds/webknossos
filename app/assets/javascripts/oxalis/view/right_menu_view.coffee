### define
backbone.marionette : marionette
###

class RightMenuView extends Backbone.Marionette.LayoutView

  MARGIN : 40
  TABS : []

  className : "flex-column"
  template : _.template("""
    <ul class="nav nav-tabs">
      <% TABS.forEach(function(tab) { %>
        <li>
          <a href="#<%= tab.id %>" data-toggle="tab"><%= tab.name %></a>
        </li>
      <% }) %>
    </ul>
    <div class="tab-content flex-column">
      <% TABS.forEach(function(tab) { %>
        <div class="tab-pane" id="<%= tab.id %>"></div>
      <% }) %>
    </div>
  """)

  ui :
    "tabContentContainer" : ".tab-content"
    "tabNavbarContainer" : ".nav-tabs"


  initialize : (options) ->

    @listenTo(@, "render", @afterRender)

    regions = {}
    @TABS.forEach (tab) =>
      tab.view = new tab.viewClass(options)
      regions[tab.id] = "#" + tab.id
    @addRegions(regions)


  resize : ->

    _.defer =>
      # make tab content 100% height
      tabContentPosition = @ui.tabContentContainer.position()
      @ui.tabContentContainer.height(window.innerHeight - tabContentPosition.top - @MARGIN)


  afterRender : ->

    @ui.tabContentContainer.children().first().addClass("active")
    @ui.tabNavbarContainer.children().first().addClass("active")

    @TABS.forEach (tab) =>
      @[tab.id].show(tab.view)


  serializeData : ->

    return {@TABS}

