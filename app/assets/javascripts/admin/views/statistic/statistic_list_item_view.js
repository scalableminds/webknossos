import _ from "lodash";
import Marionette from "backbone.marionette";

class StatisticListItemView extends Marionette.View {
  static initClass() {
  
    this.prototype.tagName  = "tr";
    this.prototype.template  = _.template(`\
<td><%- user.firstName %> <%- user.lastName %></td>
<td><%- hours %>h <%- remainingMinutes %>m</td>\
`);
  }


  serializeData() {

    const data = this.model.toJSON();

    const minutes = data.tracingTimes[0].tracingTime / 1000 / 60;
    data.hours = this.zeroPad(Math.floor(minutes / 60));
    data.remainingMinutes = this.zeroPad(Math.floor(minutes % 60));

    return data;
  }


  zeroPad(number, digits) {

    if (digits == null) { digits = 2; }
    number = `${number}`;
    while (number.length < digits) {
      number = `0${number}`;
    }
    return number;
  }
}
StatisticListItemView.initClass();

export default StatisticListItemView;
