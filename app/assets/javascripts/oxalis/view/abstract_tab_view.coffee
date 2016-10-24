Marionette = require("backbone.marionette")
_          = require("lodash")

class AbstractTabView extends Marionette.View

  MARGIN : 40

  className : "flex-column"
  template : _.template("""
    <ul class="nav nav-tabs">
      <% tabs.forEach(function(tab) { %>
        <li>
          <a href="#<%- tab.id %>" data-toggle="tab" data-tab-id="<%- tab.id %>"> <%= tab.iconString %> <%- tab.name %></a>
        </li>
      <% }) %>
    </ul>
    <div class="tab-content flex-column">
      <% tabs.forEach(function(tab) { %>
        <div class="tab-pane" id="<%- tab.id %>"></div>
      <% }) %>
    </div>
  """)

  ui :
    "tabContentContainer" : ".tab-content"
    "tabNavbarContainer" : ".nav-tabs"


  initialize : (options) ->

    @listenTo(@, "render", @afterRender)

    @adapterModel = options.adapterModel
    regions = {}
    @activeTabIndex = 0
    @tabs = @getTabs()
    @tabs.forEach (tab, index) =>
      if tab.active
        @activeTabIndex = index

      tab.view = new tab.viewClass(tab.options || options)
      tab.iconString = if tab.iconClass then "<i class=\"#{tab.iconClass}\"></i>" else ""

      regions[tab.id] = "#" + tab.id
    @addRegions(regions)


  # abstract method
  getTabs : ->

    return []


  afterRender : ->

    @$(@ui.tabContentContainer.children()[@activeTabIndex]).addClass("active")
    @$(@ui.tabNavbarContainer.children()[@activeTabIndex]).addClass("active")

    @tabs.forEach (tab) =>
      @showChildView(tab.id, tab.view)

    @$('a[data-toggle="tab"]').on('shown.bs.tab', (e) =>
      tabId = $(e.target).data("tab-id")
      tab = _.find(@tabs, (t) -> t.id == tabId)
      tab.view.render()
    )


  serializeData : ->

    return {@tabs}

module.exports = AbstractTabView
