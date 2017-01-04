import _ from "lodash";
import Backbone from "backbone";

class CommentsCollection extends Backbone.Collection {


  intitalize() {

    return this.coefficient = 1;
  }


  comparator(model) {

    return model.get("node") * this.coefficient;
  }


  sort(isAscending) {

    this.coefficient = isAscending ? 1 : -1;
    return super.sort();
  }


  findCommentByNodeId(id) {

    return this.findWhere({ node: id });
  }


  hasCommentWithNodeId(id) {

    return this.findCommentByNodeId(id) !== undefined;
  }
}

export default CommentsCollection;
