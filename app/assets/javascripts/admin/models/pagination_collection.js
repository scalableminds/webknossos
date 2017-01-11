import _ from "lodash";
import Utils from "libs/utils";
import Backbone from "backbone";

class PaginationCollection {

  constructor(models, options) {
    let left;
    _.extend(this, Backbone.Events);

    if (Utils.__guard__(options, x => x.fullCollection)) {
      this.fullCollection = options.fullCollection;
    } else {
      this.fullCollection = new Backbone.Collection(models, options);
      if (this.initialize) {
        this.initialize.call(this.fullCollection, models, options);
      }
    }

    if (this.model != null) {
      this.fullCollection.model = this.model;
    }
    if (this.url != null) {
      this.fullCollection.url = this.url;
    }
    if (this.parse != null) {
      this.fullCollection.parse = this.parse;
    }
    if (this.idAttribute != null) {
      this.fullCollection.idAttribute = this.idAttribute;
    }

    this.currentModels = this.fullCollection.models.slice();
    // eslint-disable-next-line no-cond-assign
    this.state = _.defaults((left = _.clone(this.state)) != null ? left : {}, {
      pageSize: 10,
      currentPage: 0,
      sorting: null,
      filter: null,
      collectionFilter: null,
      filterQuery: "",
    },
    );

    if (this.sortAttribute) {
      this.setSort(this.sortAttribute, "asc");
    }

    this.length = Math.min(this.state.pageSize, this.fullCollection.length);
    this.models = this.currentModels.slice(0, this.length);

    this.listenTo(this.fullCollection, "reset", this._reset);
    this.listenTo(this.fullCollection, "add", this._passthroughEvent("add"));
    this.listenTo(this.fullCollection, "remove", this._passthroughEvent("remove"));
    this.listenTo(this.fullCollection, "sync", this._passthroughEvent("sync"));

    this._reset = _.debounce(this._resetNow, 50);
  }


  add(...args) {
    return this.fullCollection.add(...args);
  }

  remove(...args) {
    return this.fullCollection.remove(...args);
  }

  set(...args) {
    return this.fullCollection.set(...args);
  }

  fetch(...args) {
    return this.fullCollection.fetch(...args);
  }

  create(...args) {
    return this.fullCollection.create(...args);
  }

  reset(...args) {
    return this.fullCollection.reset(...args);
  }


  setPageSize(pageSize) {
    this.state.pageSize = pageSize;
    this._resetNow();
  }


  setSorting(field, order) {
    this.setSort(field, order);
  }


  setSort(field, order) {
    if (order === "asc") {
      order = 1;
    }
    if (order === "desc") {
      order = -1;
    }

    this.state.sorting = function (left, right) {
      const leftValue = left.get(field);
      const rightValue = right.get(field);
      let compValue;
      if (_.isString(leftValue) && _.isString(rightValue)) {
        if (order > 0) {
          compValue = leftValue.localeCompare(rightValue);
        } else {
          compValue = rightValue.localeCompare(leftValue);
        }
      } else if (order > 0) {
        compValue = leftValue - rightValue;
      } else {
        compValue = rightValue - leftValue;
      }
      return compValue;
    };

    this._reset();
  }


  setCollectionFilter(filter) {
    this.state.collectionFilter = filter;
  }


  setFilter(fields, query) {
    if (query === "" || !_.isString(query)) {
      this.state.filterQuery = "";
      this.state.filter = null;
    } else {
      const words = _.map(query.split(" "),
        element => element.toLowerCase().replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"));
      const uniques = _.filter(_.uniq(words), element => element !== "");
      const pattern = `(${uniques.join("|")})`;
      const regexp = new RegExp(pattern, "igm");

      this.state.filterQuery = query;
      this.state.filter = model =>
        _.some(fields, (fieldName) => {
          const value = model.get(fieldName);
          if (value != null) {
            return !!value.toString().match(regexp);
          } else {
            return false;
          }
        })
      ;
    }

    this._reset();
  }


  at(index) {
    return this.currentModels[index];
  }

  get(index) {
    return this.at(index);
  }

  clone() {
    const clonedCollection = new PaginationCollection(null, {
      fullCollection: this.fullCollection,
    });
    clonedCollection.setPageSize(this.state.pageSize);
    return clonedCollection;
  }

  map(...args) {
    return _.map(this.models, ...args);
  }

  _lastPageIndex() {
    return Math.ceil(this.currentModels.length / this.state.pageSize) - 1;
  }

  _passthroughEvent(eventType) {
    return function (...args) {
      if (eventType === "sync") {
        this._resetNow();
      } else {
        this._reset();
      }
      this.trigger(eventType, ...args);
    };
  }

  _resetModels() {
    let models = this.fullCollection.models.slice();

    if (this.state.collectionFilter != null) {
      models = models.filter(this.state.collectionFilter);
    }

    if (this.state.filter != null) {
      models = models.filter(this.state.filter);
    }

    if (this.state.sorting != null) {
      models = models.sort(this.state.sorting);
    }

    this.currentModels = models;
    this.state.currentPage = Math.max(0, Math.min(
      this._lastPageIndex(),
      this.state.currentPage));
  }


  _resetNow() {
    this._resetModels();
    this.models = this.currentModels.slice(
      this.state.currentPage * this.state.pageSize,
      Math.min(
        (this.state.currentPage + 1) * this.state.pageSize,
        this.currentModels.length));

    this.length = this.models.length;
    this.trigger("reset");
  }


  getPaginationInfo() {
    return {
      firstPage: 0,
      lastPage: this._lastPageIndex(),
      currentPage: this.state.currentPage,
      pageSize: this.state.pageSize,
    };
  }


  getPreviousPage() {
    this.getPage(this.state.currentPage - 1);
  }


  getNextPage() {
    this.getPage(this.state.currentPage + 1);
  }


  getFirstPage() {
    this.getPage(0);
  }


  getLastPage() {
    this.getPage(this._lastPageIndex());
  }


  getPage(pageIndex) {
    if (pageIndex >= 0 && pageIndex < Math.ceil(this.currentModels.length / this.state.pageSize)) {
      this.state.currentPage = pageIndex;
      this._reset();
    }
  }

  toJSON() {
    return this.models.map(model => model.toJSON());
  }


  findWhere(...args) {
    return this.fullCollection.findWhere(...args);
  }
}


export default PaginationCollection;
