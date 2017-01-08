import _ from "lodash";
import Backbone from "backbone";

class UserStatisticCollection extends Backbone.Collection {
  static initClass() {
    this.prototype.url = "/api/statistics/users";
  }

  parse(responses) {
    return responses.map((response) => {
      if (_.isEmpty(response.tracingTimes)) {
        response.tracingTimes.push({ tracingTime: 0 });
      }

      return response;
    });
  }
}
UserStatisticCollection.initClass();


export default UserStatisticCollection;
