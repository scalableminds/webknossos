import _ from "lodash";
import backbone from "backbone";

class UserStatisticCollection extends Backbone.Collection {
  static initClass() {
  
    this.prototype.url  = "/api/statistics/users";
  }

  parse(responses) {

    return responses.map(function(response) {

      if (_.isEmpty(response.tracingTimes)) {
        response.tracingTimes.push({tracingTime: 0});
      }

      return response;
    });
  }
}
UserStatisticCollection.initClass();


export default UserStatisticCollection;
