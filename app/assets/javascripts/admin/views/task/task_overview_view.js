import _ from "lodash";
import Marionette from "backbone.marionette";
import d3 from "d3";
import cola from "webcola/WebCola/cola";
import moment from "moment";
import routes from "routes";
import RangeSlider from "nouislider";
import Utils from "libs/utils";
import TeamCollection from "admin/models/team/team_collection";
import SelectionView from "admin/views/selection_view";
import DateRangePicker from "bootstrap-daterangepicker";

class TaskOverviewView extends Marionette.View {
  static initClass() {

    this.prototype.id  = "task-overview";
    this.prototype.className  = "container wide";
    this.prototype.template  = _.template(`\
<h3>TaskType - User Overview</h3>
<div>
  <p>All ovals symbolize task types and/or projects. Users are drawn as rectangles. Blue lines symbolize the next task type the user gets, after he has finished his current task. If the user currently has a task, then there is a black arrow drawn to the task type and/or the project of the task. </p>
</div>
<div class="overview-options">
  <label class="checkbox">
    <input type="checkbox" id="taskTypesCheckbox">Task types
  </label>
  <label class="checkbox">
    <input type="checkbox" id="projectsCheckbox">Projects
  </label>
  <label for="team">Team</label>
  <div class="team"></div>
  <label for="dateRangeInput">Date range</label>
  <input type="text" class="form-control" id="dateRangeInput"/>
  <label for="rangeSliderInput">Hour range</label>
  <div id="rangeSliderInput"></div>
  <div id="colorLegend"></div>
  <div id="rangeSliderLabels">
    <span id="rangeSliderLabel1"/>
    <span id="rangeSliderLabel2"/>
    <span id="rangeSliderLabel3"/>
  </div>
</div>

<div class="graph well">
  <p><i class="fa fa-refresh rotating"></i>Loading ...</p>
</div>\
`);

    this.prototype.regions  =
      {"team" : ".team"};

    this.prototype.events  = {
      "change @ui.taskTypesCheckbox" : "selectionChanged",
      "change @ui.projectsCheckbox" : "selectionChanged"
    };

    this.prototype.ui  = {
      "graph" : ".graph",
      "taskTypesCheckbox" : "#taskTypesCheckbox",
      "projectsCheckbox" : "#projectsCheckbox",
      "team" : ".team",
      "dateRangeInput" : "#dateRangeInput",
      "rangeSliderInput" : "#rangeSliderInput",
      "rangeSliderLabel1" : "#rangeSliderLabel1",
      "rangeSliderLabel2" : "#rangeSliderLabel2",
      "rangeSliderLabel3" : "#rangeSliderLabel3"
    };

    this.prototype.DEFAULT_TEAM  = "Tracing crew";

    this.prototype.DEFAULT_TIME_PERIOD_UNIT  = "month";
    this.prototype.DEFAULT_TIME_PERIOD_TIME  = 3;
    this.prototype.MS_PER_HOUR  = 3600000;

    // These values will be configured by the user, using the RangeSlider
    this.prototype.chosenMinHours  = 0;
    this.prototype.chosenMaxHours  = 24 * 356 * 100;

    // Graph constants
    this.prototype.FORCE_LAYOUT_TIMEOUT  = 10000;
    this.prototype.RECT_HEIGHT  = 30;
    this.prototype.TEXT_PADDING  = 10;
    this.prototype.OPTIONS_MARGIN  = 30;
    this.prototype.FUTURE_TASK_EDGE_COLOR  = "#3091E6";
    this.prototype.MAX_SCALE  = 3.0;



    // utility functions

    this.prototype.color  = (() =>
      // Red -> Yellow -> Green
      d3.scale.linear()
      .domain([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1])
      .range(["#a50026","#d73027","#f46d43","#fdae61","#fee08b","#ffffbf","#d9ef8b","#a6d96a","#66bd63","#1a9850","#006837"])
    )();
  }


  initialize() {

    const defaultStartDate = moment().startOf("day").subtract(this.DEFAULT_TIME_PERIOD_TIME, this.DEFAULT_TIME_PERIOD_UNIT).valueOf();
    const defaultEndDate = moment().endOf("day").valueOf();
    this.fetchData(defaultStartDate, defaultEndDate);

    return this.listenTo(this.collection, "change", this.renderRangeSlider);
  }


  fetchData(start, end) {

    this.fetchPromise = this.collection.fetch({
      data: {
        start,
        end
      }
    });
    return this.updateMinMaxHours();
  }


  getMinMaxHours() {

    // This function calculates the min/max working hours of the users of the selected team
    if (_.isEmpty(this.minMaxHours)) {
      const selectedUsers = _.filter(this.collection.get("userInfos"), userInfo => _.map(userInfo.user.teams, "team").includes(this.team));
      let workingTimes = _.map(selectedUsers, "workingTime");

      if (_.isEmpty(workingTimes)) { workingTimes = [0]; }
      const minTime = Math.min(...workingTimes);
      const maxTime = Math.max(...workingTimes);

      // Convert ms to h
      this.minMaxHours = {
        min: Math.floor(minTime / this.MS_PER_HOUR),
        max: Math.ceil(maxTime / this.MS_PER_HOUR)
      };
      if (this.minMaxHours.min === this.minMaxHours.max) {
        this.minMaxHours.max += 1;
      }
    }

    return this.minMaxHours;
  }


  updateMinMaxHours() {

    return this.fetchPromise.then( () => {
      this.minMaxHours = {};
      return this.getMinMaxHours();
    }
    );
  }


  updateSelectedTeam() {

    this.team = this.ui.team.find("select")[0].value;
    this.updateMinMaxHours();
    return this.renderRangeSlider();
  }


  onRender() {

    this.ui.taskTypesCheckbox.prop("checked", true);
    this.initializeDateRangePicker();
    this.renderTeamDropdown();
    this.renderRangeSlider();
    _.defer(this.buildGraph.bind(this));
    return this.paintGraphDebounced();
  }


  initializeDateRangePicker() {
    $(this.ui.dateRangeInput[0]).daterangepicker({
      locale: {
        format: "L"
      },
      startDate: moment().subtract(this.DEFAULT_TIME_PERIOD_TIME, this.DEFAULT_TIME_PERIOD_UNIT).format("L"),
      endDate: moment().format("L"),
      opens: "left"
    },
    (start, end, label) => {
      this.fetchData(start.valueOf(), end.valueOf());
      return this.paintGraphDebounced();
    }
    );
  }


  renderTeamDropdown() {

    // sort the collection so the default team is the first one
    // don't bind the comparator function though as backbones sorting is
    // checking for the number of arguments which could lead to strange behaviour when bound
    const defaultTeam = this.DEFAULT_TEAM;
    const teamCollection = new TeamCollection(null, {
      comparator(teams) {
        if (teams.get("name") === defaultTeam) { return 0; } else { return 1; }
      }
    }
    );

    const teamSelectionView = new SelectionView({
      collection: teamCollection,
      childViewOptions: {
        modelValue() { return `${this.model.get("name")}`; }
      },
      name: "team",
      events: {
        change: () => {
          this.updateSelectedTeam();
          this.paintGraphDebounced();
        }
      }
    });

    this.showChildView("team", teamSelectionView);
    return this.listenTo(teamSelectionView, "render", () => this.updateSelectedTeam());
  }


  renderRangeSlider() {

    const sliderEl = this.ui.rangeSliderInput[0];

    return this.fetchPromise.then( () => {
      const minMaxHours = this.getMinMaxHours();

      // Destroy existing instance to reconfigure
      if (sliderEl.noUiSlider) {
        sliderEl.noUiSlider.destroy();
      }

      RangeSlider.create(sliderEl, {
        start: [
          Math.max(minMaxHours.min, this.chosenMinHours),
          Math.min(minMaxHours.max, this.chosenMaxHours)
        ],
        connect: true,
        step: 1,
        margin: 1,
        range: minMaxHours
      }
      );

      return sliderEl.noUiSlider.on("update", (values, handle) => {
        this.chosenMinHours = Math.round(+values[0]);
        this.chosenMaxHours = Math.round(+values[1]);
        this.ui.rangeSliderLabel1.html(`${this.chosenMinHours}h`);
        this.ui.rangeSliderLabel2.html(`${Utils.roundTo((+values[0] + +values[1]) / 2, 1)}h`);
        this.ui.rangeSliderLabel3.html(`${this.chosenMaxHours}h`);
        return this.paintGraphDebounced();
      }
      );
    }
    );
  }


  paintGraphDebounced() {

    const paintFkt = this.paintGraph.bind(this);
    this.paintGraphDebounced = _.debounce(paintFkt, 500);
    return this.paintGraphDebounced();
  }


  paintGraph() {

    return this.renderSVG();
  }


  selectionChanged() {

    return this.paintGraph();
  }


  doDrawTaskTypes() {

    return $(this.ui.taskTypesCheckbox).prop("checked");
  }


  doDrawProjects() {

    return $(this.ui.projectsCheckbox).prop("checked");
  }


  doDrawUser(user) {

    const isWithinWorkingHours = this.chosenMinHours <= user.workingHours && user.workingHours <= this.chosenMaxHours;
    const isInTeam = _.map(user.teams, "team").includes(this.team);

    return isWithinWorkingHours && isInTeam;
  }


  renderSVG() {

    return this.fetchPromise.then( () => {

      // { userInfos, taskTypes, projects } = @model.attributes
      // move workingTime to user object and convert to hours
      this.collection.forEach(userInfoModel => userInfoModel.get("user").workingHours = Utils.roundTo(userInfoModel.get("workingTime") / this.MS_PER_HOUR, 2) );

      // extract users and add full names
      this.users = this.collection.pluck("user");
      this.users.map( user => user.name = user.firstName + " " + user.lastName);

      const taskTypes = _.flatten(this.collection.pluck("taskTypes"));
      const projects = _.flatten(this.collection.pluck("projects"));

      const nodes = this.buildNodes(taskTypes, projects);
      const edges = this.buildEdges(nodes);

      return this.updateGraph(nodes, edges);
    }
    );
  }


  buildGraph() {

    const width  = $(".graph").width() - this.OPTIONS_MARGIN - $(".overview-options").width();
    const height = $(window).height() - 50 - $(".graph").offset().top;

    this.svg = d3.select(".graph")
      .html("")
      .append("svg")
      .attr("width", width)
      .attr("height", height);

    this.container = this.svg.append("svg:g");

    this.svgEdges = this.container.append("svg:g").selectAll("path");
    this.svgNodes = this.container.append("svg:g").selectAll("g");

    this.setupPanAndZoom();

  }


  updateGraph(nodes, edges) {

    // initialize nodes with random position as this yields faster results
    nodes.forEach( n => {
      n.x = Math.random() * this.svg.attr("width");
      return n.y = Math.random() * this.svg.attr("height");
    }
    );

    const { RECT_HEIGHT } = this;
    const { TEXT_PADDING } = this;

    // stop existing force layout and cancel its timeout
    if (this.force) { this.force.stop(); }
    if (this.forceTimeout) { clearTimeout(this.forceTimeout); }

    // clear old selection data and svg elements
    this.svgEdges.remove();
    this.svgEdges = this.svgEdges.data([]);
    this.svgNodes.remove();
    this.svgNodes = this.svgNodes.data([]);

    // append the svg path elements
    this.svgEdges = this.svgEdges.data(edges)
      .enter().append("svg:path")
      .attr("class", "link")
      .attr("stroke", d => d.color)
      .attr("stroke-dasharray", d => { if (d.color === this.FUTURE_TASK_EDGE_COLOR) { return "10,10"; } });

    // append the container for the svg node elements
    this.svgNodes = this.svgNodes.data(nodes, d => d.id);
    const svgNodesContainer = this.svgNodes.enter().append("svg:g")
      .attr("id", d => d.id);

    // add the label to the svg node container
    svgNodesContainer.append("svg:text")
      .attr("class", "id")
      .text( d => d.text)
      .each( function(d) {
        d.width = this.getBBox().width + TEXT_PADDING;
        return d.height = RECT_HEIGHT;
      })
      .attr("x", d => d.width / 2)
      .attr("y", RECT_HEIGHT / 2);

    // add the rectangle to the svg node container
    svgNodesContainer.insert("svg:rect", ":first-child")
      .attr("class", "node")
      .attr("width", d => d.width)
      .attr("height", RECT_HEIGHT)
      .attr("rx", function(d) { if (d.type === "user") { return 3; } else { return 10; }  })
      .attr("ry", function(d) { if (d.type === "user") { return 3; } else { return 10; }  })
      .style("fill", function(d) { if (d.color) { return d.color; } else { return "white"; } })
      .style("stroke", function(d) { if (d.color) { return d3.rgb(d.color).darker().toString(); } else { return "black"; } });

    this.zoomOnce = _.once(() => this.zoomToFitScreen());

    // the force layout needs to be newly created every time
    // using the old one leads to incorrect layouts as colajs seems to mistakenly use old state
    this.force = cola.d3adaptor()
      .size([this.svg.attr("width"), this.svg.attr("height")])
      .nodes(nodes)
      .links(edges)
      .symmetricDiffLinkLengths(200)
      .avoidOverlaps(true)
      .convergenceThreshold(0.10)
      .on("tick", this.tick.bind(this));

    // unconstrained, user-constrained, overlap-constrained iterations
    this.force.start(15, 0, 10);

    // stop force layout calculation after FORCE_LAYOUT_TIMEOUT ms
    this.forceTimeout = setTimeout(this.force.stop.bind(this.force), this.FORCE_LAYOUT_TIMEOUT);

    return this.setupPopovers();
  }


  tick() {

    // update the position of the edges
    // distribute the start and end point on the x-axis depending on their direction
    this.svgEdges.attr("d", function(d) {
      const deltaX = d.target.x - d.source.x;
      const deltaY = d.target.y - d.source.y;
      const dist = Math.sqrt((deltaX * deltaX) + (deltaY * deltaY));
      const normX = deltaX / dist;
      const sourcePadding = Math.min(25, d.source.width / 2);
      const targetPadding = Math.min(25, d.target.width / 2);
      const sourceX = d.source.x + (sourcePadding * normX);
      const sourceY = d.source.y;
      const targetX = d.target.x - (targetPadding * normX);
      const targetY = d.target.y;
      return `M${sourceX},${sourceY}L${targetX},${targetY}`;
    });

    // update the position of the nodes
    this.svgNodes.attr("transform", d => `translate(${d.x - (d.width / 2)},${d.y - (d.height / 2)})`);

    // this will only be called after the first tick
    return this.zoomOnce();
  }


  buildNodes(taskTypes, projects) {

    let nodes = [];

    nodes = nodes.concat(_.compact(this.users.map( user => {
      if (this.doDrawUser(user)) {
        return {
          id: user.id,
          text: user.firstName + " " + user.lastName,
          color: this.color((user.workingHours - this.chosenMinHours) / (this.chosenMaxHours - this.chosenMinHours)),
          type: "user"
        };
      }
    }
    )));

    if (this.doDrawTaskTypes()) {
      nodes = nodes.concat(taskTypes.map( taskType =>
        ({
          id: taskType._id.$oid,
          text: taskType.summary,
          type: "taskType"
        })
      ));
    }

    if (this.doDrawProjects()) {
      nodes = nodes.concat(projects.map( project =>
        ({
          id: project._id.$oid,
          text: project.name,
          type: "project"
        })
      ));
    }

    return nodes;
  }


  buildEdges(nodes) {

    let user;
    let edges = [];

    // only draw edges for users that are displayed in the graph
    const selectedUserInfos = this.collection.filter(userInfo => this.doDrawUser(userInfo.get("user")));

    if (this.doDrawTaskTypes()) {

      // task type edges
      edges = edges.concat(_.flatten(selectedUserInfos.map( userInfo => {
        user = userInfo.get("user");
        const taskTypes = userInfo.get("taskTypes");
        if (this.doDrawUser(user)) { return taskTypes.map( taskType => this.edge(user.id, taskType._id.$oid, nodes)); }
      }
      )));

      // future task type edges
      edges = edges.concat(_.flatten(selectedUserInfos.map( userInfo => {
        user = userInfo.get("user");
        const futureTaskType = userInfo.get("futureTaskType");
        if(futureTaskType) {
          if (this.doDrawUser(user)) { return this.edge(user.id, futureTaskType._id.$oid, nodes, this.FUTURE_TASK_EDGE_COLOR); }
        }
      }
      )));
    }

    // project edges
    if (this.doDrawProjects()) {
      edges = edges.concat(_.flatten(selectedUserInfos.map( userInfo => {
        user = userInfo.get("user");
        const projects = userInfo.get("projects");
        if (this.doDrawUser(user)) { return projects.map( project => this.edge(user.id, project._id.$oid, nodes)); }
      }
      )));
    }

    return _.compact(edges);
  }


  setupPanAndZoom() {

    this.zoom = d3.behavior.zoom()
      .scaleExtent([0.1, 10])
      .on("zoom", () => {
        return this.container.attr("transform", `translate(${d3.event.translate})scale(${d3.event.scale})`);
      }
      );

    return this.svg.call(this.zoom);
  }


  setupPopovers() {

    return this.users.forEach( user => {
      return $(`#${user.id}`).popover({
        title: user.firstName + " " + user.lastName,
        html: true,
        trigger: "hover",
        content: this.createUserTooltip(user),
        container: "body"
      });
    }
    );
  }


  createUserTooltip(user) {

    return [`Working time: ${user.workingHours}h`,
     "Experiences:",
      _.map(user.experiences, (domain, value) => domain + " : " + value).join("<br />")
    ].join("<br />");
  }


  zoomToFitScreen() {

    const transitionDuration = 400;

    const bounds = this.container.node().getBBox();
    const fullWidth = this.svg.node().clientWidth;
    const fullHeight = this.svg.node().clientHeight;
    const { width } = bounds;
    const { height } = bounds;
    const midX = bounds.x + (width / 2);
    const midY = bounds.y + (height / 2);
    if (width === 0 || height === 0) { return; } // nothing to fit
    let scale = 0.90 / Math.max(width / fullWidth, height / fullHeight);
    // limit scale to a reasonable magnification
    scale = Math.min(scale, this.MAX_SCALE);
    const translate = [(fullWidth / 2) - (scale * midX), (fullHeight / 2) - (scale * midY)];

    return this.container
      .transition()
      .duration(transitionDuration || 0)
      .call(this.zoom.translate(translate).scale(scale).event);
  }

  edge(idA, idB, nodes, color) {
    if (color == null) { color = "black"; }
    return {
      source : _.find(nodes, {"id" : idA}),
      target : _.find(nodes, {"id" : idB}),
      color
    };
  }
}
TaskOverviewView.initClass();

export default TaskOverviewView;
