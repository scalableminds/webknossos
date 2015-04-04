### define
backbone.marionette : marionette
###

class AbstractTabView extends Backbone.Marionette.LayoutView

  MARGIN : 40
  TABS : []

  className : "flex-column-container"
  template : _.template("""
    <ul class="nav nav-tabs">
      <% TABS.forEach(function(tab) { %>
        <li>
          <a href="#<%= tab.id %>" data-toggle="tab"> <%= tab.iconString %> <%= tab.name %></a>
        </li>
      <% }) %>
    </ul>
    <div class="tab-content">
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
    @activeTabIndex = 0
    @TABS.forEach (tab, index) =>
      if tab.active
        @activeTabIndex = index

      tab.view = new tab.viewClass(options)
      tab.iconString = if tab.iconClass then "<i class=\"#{tab.iconClass}\"></i>" else ""

      regions[tab.id] = "#" + tab.id
    @addRegions(regions)


  resize : ->

    _.defer =>
      # make tab content 100% height
      tabContentPosition = @ui.tabContentContainer.position()
      @ui.tabContentContainer.height(window.innerHeight - tabContentPosition.top - @MARGIN)


  afterRender : ->

    @$(@ui.tabContentContainer.children()[@activeTabIndex]).addClass("active")
    @$(@ui.tabNavbarContainer.children()[@activeTabIndex]).addClass("active")

    @TABS.forEach (tab) =>
      @[tab.id].show(tab.view)


  serializeData : ->

    return {@TABS}

