import _ from "lodash";
import Marionette from "backbone.marionette";
import Request from "libs/request";
import Toast from "libs/toast";
import TaskCollection from "admin/models/task/task_collection";
import PaginationView from "admin/views/pagination_view";
import PaginationCollection from "admin/models/pagination_collection";
import ace from "brace";
import "brace/mode/javascript";
import "brace/mode/json";
import "brace/theme/clouds";
import TaskListView from "admin/views/task/task_list_view";
import TaskQueryDocumentationModal from "admin/views/task/task_query_documentation_modal";

class TaskQueryView extends Marionette.View {
  static initClass() {
    this.prototype.template = _.template(`\
<div class="container wide">
  <h3>Tasks</h3>

  <div class="row">
    <div class="col-sm-9">
      <div id="query" style="width: 100%; height: 100px; display: inline-block; border: 1px solid #ddd"></div>
    </div>
    <div class="col-sm-3">
      <div style="vertical-align: top; display: inline-block">
        <a class="btn btn-primary search-button" href="#">
          <i class="fa fa-search"></i>Search
        </a>
        <div class="btn-group btn-group.btn-group-justified" role="group">
          <a class="btn btn-default documentation-button" role="button" href="#">
            <i class="fa fa-question-circle"></i>Documentation
          </a>
          <a class="btn btn-default" role="button" href="/help/faq#taskqueries">
             <i class="fa fa-info"></i>Examples
          </a>
        </div>
      </div>
    </div>
  </div>
  <hr>
</div>
<div class="paginator"></div>
<div class="taskList"></div>
<div id="modal-wrapper"></div>\
`);

    this.prototype.regions = {
      paginator: ".paginator",
      taskList: ".taskList",
    };

    this.prototype.ui = {
      taskList: ".taskList",
      query: "#query",
      modalWrapper: "#modal-wrapper",
    };

    this.prototype.events = {
      "click .search-button": "search",
      "click .documentation-button": "showDocumentation",
    };
  }

  onRender() {
    this.collection = new TaskCollection(null);
    const paginatedCollection = new PaginationCollection([], { fullCollection: this.collection });
    this.taskListView = new TaskListView({ collection: paginatedCollection });

    const paginationView = new PaginationView({
      collection: paginatedCollection,
      addButtonText: "Create New Task",
    });

    this.showChildView("taskList", this.taskListView);
    this.showChildView("paginator", paginationView);

    this.documentationModal = new TaskQueryDocumentationModal();
    this.documentationModal.render();
    this.ui.modalWrapper.html(this.documentationModal.el);

    this.editor = ace.edit(this.ui.query[0]);
    this.editor.getSession().setMode("ace/mode/javascript");
    this.editor.setTheme("ace/theme/clouds");
    const defaultQuery = '{\n\t"_id": {"$oid": "56cb594a16000045b4d0f273"}\n}';
    this.editor.setValue(defaultQuery);
    this.editor.clearSelection();
    return this.editor.resize();
  }

  search() {
    let queryObject;
    const queryString = this.editor.getValue();
    try {
      queryObject = JSON.parse(queryString);
    } catch (jsonError) {
      try {
        // This is an eval hack in order to allow JSON without quoted keys.
        // JS is only executed locally so it doesn't yield more power than the
        // browser console.
        // eslint-disable-next-line no-eval
        queryObject = eval(`(function() { return eval(${queryString}); })()`);
      } catch (evalError) {
        Toast.error("The task query couldn't be parsed. Ensure that the query is valid JSON.");
      }
    }

    return Request.sendJSONReceiveJSON("/api/queries", {
      params: { type: "task" },
      data: queryObject,
    }).then(result => {
      this.collection.reset();
      const defaultQueryLimit = 100;
      if (result.length === defaultQueryLimit) {
        Toast.warning(
          `Not all results are shown because there are more than ${defaultQueryLimit}. Try to narrow your query.`,
        );
      }
      return this.collection.addObjects(result);
    });
  }

  showDocumentation() {
    return this.documentationModal.$el.modal("show");
  }
}
TaskQueryView.initClass();

export default TaskQueryView;
