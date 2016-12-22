import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import c3 from "c3";
import moment from "moment";

class GraphView extends Marionette.View {
  static initClass() {
  
    this.prototype.template  = _.template(`\
<h3>Overall Weekly Tracing Time</h3>
<div id="graph"></div>\
`);
  }


  initialize() {

    return this.listenTo(this, "attach", this.addGraph);
  }


  addGraph() {


    let graph;
    const previousWeeks = this.model.get("tracingTimes").map(item => parseInt(moment.duration(item.get("tracingTime")).asHours()));
    const currentWeek = previousWeeks.length - 1;

    const dates = this.model.get("tracingTimes").map(item => moment(item.get("start")).format("YYYY-MM-DD"));

    return graph = c3.generate({
      bindto : "#graph",
      data : {
        x : "date",
        columns: [
          ["date"].concat(dates),
          ["WeeklyHours"].concat(previousWeeks)
        ],
        color(color, d) { return d.index === currentWeek ? "#48C561" : color; }, // color current week differently
        selection : {
          enabled : true,
          grouped : false,
          multiple : false
        },
        onclick : this.selectDataPoint
      },
      axis : {
        x : {
          type : "timeseries"
        },
        y : {
          label : "hours / week"
        }
      },
      legend : {
        show : false
      }
    });
  }


  selectDataPoint(data) {

    return app.vent.trigger("graphView:updatedSelection", data);
  }
}
GraphView.initClass();

export default GraphView;
