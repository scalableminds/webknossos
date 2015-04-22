### define
backbone.marionette : marionette
underscore : _
###

class AbstractTabView extends Backbone.Marionette.LayoutView

  MARGIN : 40
  TABS : []

  className : "flex-column"
  template : _.template("""
    <ul class="nav nav-tabs">
      <% TABS.forEach(function(tab) { %>
        <li>
          <a href="#<%= tab.id %>" data-toggle="tab" data-tab-id="<%= tab.id %>"> <%= tab.iconString %> <%= tab.name %></a>
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


  afterRender : ->

    @$(@ui.tabContentContainer.children()[@activeTabIndex]).addClass("active")
    @$(@ui.tabNavbarContainer.children()[@activeTabIndex]).addClass("active")

    @TABS.forEach (tab) =>
      @[tab.id].show(tab.view)

    @$('a[data-toggle="tab"]').on('shown.bs.tab', (e) =>
      tabId = $(e.target).data("tab-id")
      tab = _.find(@TABS, (t) -> t.id == tabId)
      tab.view.render()
    )


  serializeData : ->

    return {@TABS}

