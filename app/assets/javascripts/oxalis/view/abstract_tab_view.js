import _ from "lodash";
import $ from "jquery";
import Marionette from "backbone.marionette";

class AbstractTabView extends Marionette.View {
  static initClass() {
    this.prototype.MARGIN = 40;

    this.prototype.className = "flex-column";
    this.prototype.template = _.template(`\
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
</div>\
`);

    this.prototype.ui = {
      tabContentContainer: ".tab-content",
      tabNavbarContainer: ".nav-tabs",
    };
  }


  initialize(options) {
    this.listenTo(this, "render", this.afterRender);

    this.adapterModel = options.adapterModel;
    const regions = {};
    this.activeTabIndex = 0;
    this.tabs = this.getTabs();
    this.tabs.forEach((tab, index) => {
      if (tab.active) {
        this.activeTabIndex = index;
      }

      // eslint-disable-next-line new-cap
      tab.view = new tab.viewClass(tab.options || options);
      tab.iconString = tab.iconClass ? `<i class="${tab.iconClass}"></i>` : "";

      regions[tab.id] = `#${tab.id}`;
    },
    );
    this.addRegions(regions);
  }


  // abstract method
  getTabs() {
    return [];
  }


  afterRender() {
    this.$(this.ui.tabContentContainer.children()[this.activeTabIndex]).addClass("active");
    this.$(this.ui.tabNavbarContainer.children()[this.activeTabIndex]).addClass("active");

    this.tabs.forEach(tab => this.showChildView(tab.id, tab.view),
    );

    return this.$("a[data-toggle=\"tab\"]").on("shown.bs.tab", (e) => {
      const tabId = $(e.target).data("tab-id");
      const tab = _.find(this.tabs, t => t.id === tabId);
      return tab.view.render();
    },
    );
  }


  serializeData() {
    return { tabs: this.tabs };
  }
}
AbstractTabView.initClass();

export default AbstractTabView;
