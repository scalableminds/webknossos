import _ from "lodash";
import Backbone from "backbone";
import moment from "moment";

class TimeStatisticModel extends Backbone.Model {
  static initClass() {
    this.prototype.url = "api/statistics/webknossos";
  }

  initialize() {
    // set defaults
    return this.set("tracingTimes", new Backbone.Collection([{
      start: moment().startOf("week"),
      end: moment().endOf("week"),
      tracingTime: 0 }]),
    );
  }


  parse(response) {
    const timings = _.sortBy(response.tracingTimes, timeEntry => timeEntry.start);
    response.tracingTimes = new Backbone.Collection(timings);

    return response;
  }
}
TimeStatisticModel.initClass();

export default TimeStatisticModel;

