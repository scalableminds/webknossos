webpackJsonp([21],{

/***/ 182:
/***/ function(module, exports, __webpack_require__) {

	var ProjectModel, _, backbone,
	  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
	  hasProp = {}.hasOwnProperty;
	
	_ = __webpack_require__(2);
	
	backbone = __webpack_require__(3);
	
	ProjectModel = (function(superClass) {
	  extend(ProjectModel, superClass);
	
	  function ProjectModel() {
	    return ProjectModel.__super__.constructor.apply(this, arguments);
	  }
	
	  ProjectModel.prototype.urlRoot = "/api/projects";
	
	  ProjectModel.prototype.idAttribute = "name";
	
	  ProjectModel.prototype["default"] = {
	    owner: {
	      firstName: "",
	      lastName: ""
	    },
	    priority: 100
	  };
	
	  ProjectModel.prototype.parse = function(response) {
	    response.owner || (response.owner = this["default"].owner);
	    return response;
	  };
	
	  return ProjectModel;
	
	})(Backbone.Model);
	
	module.exports = ProjectModel;


/***/ },

/***/ 332:
/***/ function(module, exports, __webpack_require__) {

	var __WEBPACK_AMD_DEFINE_ARRAY__, __WEBPACK_AMD_DEFINE_RESULT__;(function(root, factory) {
	  if (true) {
	    !(__WEBPACK_AMD_DEFINE_ARRAY__ = [__webpack_require__(2), __webpack_require__(1)], __WEBPACK_AMD_DEFINE_RESULT__ = function(_, $) {
	      return factory(root, _, $);
	    }.apply(exports, __WEBPACK_AMD_DEFINE_ARRAY__), __WEBPACK_AMD_DEFINE_RESULT__ !== undefined && (module.exports = __WEBPACK_AMD_DEFINE_RESULT__));
	  } else if (typeof exports !== 'undefined') {
	    var _ = require('lodash');
	    var $ = require('jquery');
	    module.exports = factory(root, _, $);
	  } else {
	    root.FormSyphon = factory(root, root._, (root.jQuery || root.Zepto || root.ender || root.$));
	  }
	}(this, function(root, _, $) {
	
	var FormSyphon, assignKeyValue, flattenData, getElementType, getter;
	
	getter = function(obj, key) {
	  if (obj[key]) {
	    return obj[key];
	  } else {
	    return obj["default"];
	  }
	};
	
	assignKeyValue = function(obj, keychain, value) {
	  var key;
	  if (!keychain) {
	    return obj;
	  }
	  key = keychain.shift();
	  if (!obj[key]) {
	    obj[key] = _.isArray(key) ? [] : {};
	  }
	  if (keychain.length === 0) {
	    if (_.isArray(obj[key])) {
	      obj[key].push(value);
	    } else {
	      obj[key] = value;
	    }
	  }
	  if (keychain.length > 0) {
	    assignKeyValue(obj[key], keychain, value);
	  }
	  return obj;
	};
	
	flattenData = function(data, parentKey, keyJoiner) {
	  var flatData;
	  flatData = {};
	  _.each(data, function(value, keyName) {
	    var hash;
	    hash = {};
	    if (parentKey) {
	      keyName = keyJoiner(parentKey, keyName);
	    }
	    if (_.isArray(value)) {
	      keyName += "[]";
	      hash[keyName] = value;
	    } else if (_.isPlainObject(value)) {
	      hash = flattenData(value, keyName, keyJoiner);
	    } else {
	      hash[keyName] = value;
	    }
	    return _.extend(flatData, hash);
	  });
	  return flatData;
	};
	
	getElementType = function($el) {
	  var type;
	  type = $el.prop("tagName").toLowerCase();
	  if (type === "input") {
	    type = $el.attr("type") || "text";
	  }
	  return type;
	};
	
	FormSyphon = {
	  serialize: function($el) {
	    var result;
	    result = {};
	    _.forEach($el.find(":input"), (function(_this) {
	      return function(input) {
	        var $input, keychain, type, value;
	        $input = $(input);
	        type = getElementType($input);
	        keychain = _this.keySplitter(_this.keyExtractor($input));
	        if (!keychain) {
	          return;
	        }
	        value = getter(_this.readers, type)($input);
	        if (getter(_this.keyAssignmentValidators, type)($input, keychain, value)) {
	          return assignKeyValue(result, keychain, value);
	        }
	      };
	    })(this));
	    return result;
	  },
	  deserialize: function($el, data) {
	    var flatData;
	    flatData = flattenData(data, null, this.keyJoiner);
	    _.forEach($el.find(":input"), (function(_this) {
	      return function(input) {
	        var $input, key, type;
	        $input = $(input);
	        type = getElementType($input);
	        key = _this.keyExtractor($input);
	        if (!key) {
	          return;
	        }
	        return getter(_this.writers, type)($input, flatData[key]);
	      };
	    })(this));
	  },
	  keyAssignmentValidators: {
	    "default": function() {
	      return true;
	    },
	    radio: function($el, key, value) {
	      return $el.prop("checked");
	    }
	  },
	  readers: {
	    "default": function($el) {
	      return $el.val();
	    },
	    number: function($el) {
	      return parseFloat($el.val());
	    },
	    checkbox: function($el) {
	      return $el.prop("checked");
	    },
	    date: function($el) {
	      return new Date($el.val());
	    }
	  },
	  writers: {
	    "default": function($el, value) {
	      return $el.val(value);
	    },
	    date: function($el, value) {
	      return $el.val(value.toJSON().substring(0, 10));
	    },
	    checkbox: function($el, value) {
	      return $el.prop("checked", value);
	    },
	    radio: function($el, value) {
	      return $el.prop("checked", $(el).val() === value.toString());
	    }
	  },
	  keyExtractor: function($el) {
	    return $el.prop("name");
	  },
	  keyJoiner: function(parentKey, key) {
	    return "" + parentKey + "[" + key + "]";
	  },
	  keySplitter: function(key) {
	    var lastKey, matches;
	    matches = key.match(/[^\[\]]+/g);
	    if (key.length > 1 && key.indexOf("[]") === key.length - 2) {
	      lastKey = matches.pop();
	      matches.push([lastKey]);
	    }
	    return matches || null;
	  }
	};
	
	return FormSyphon;
	}));


/***/ },

/***/ 411:
/***/ function(module, exports, __webpack_require__) {

	var FormSyphon, Marionette, ProjectEditView, Toast, _, app,
	  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
	  hasProp = {}.hasOwnProperty;
	
	_ = __webpack_require__(2);
	
	app = __webpack_require__(48);
	
	FormSyphon = __webpack_require__(332);
	
	Marionette = __webpack_require__(49);
	
	Toast = __webpack_require__(18);
	
	ProjectEditView = (function(superClass) {
	  extend(ProjectEditView, superClass);
	
	  function ProjectEditView() {
	    return ProjectEditView.__super__.constructor.apply(this, arguments);
	  }
	
	  ProjectEditView.prototype.template = _.template("<div class=\"row\">\n  <div class=\"col-sm-12\">\n    <div class=\"well\">\n      <div class=\"col-sm-9 col-sm-offset-2\">\n        <h3>Update project</h3>\n      </div>\n\n      <form method=\"POST\" class=\"form-horizontal\">\n        <div class=\"form-group\">\n          <label class=\"col-sm-2\" for=\"team\">Team</label>\n          <div class=\"col-sm-10 team\">\n            <input type=\"text\" class=\"form-control\" name=\"team\" value=\"<%= team %>\" required autofocus disabled>\n          </div>\n        </div>\n        <div class=\"form-group\">\n          <label class=\"col-sm-2 for=\"name\">Project Name</label>\n          <div class=\"col-sm-10\">\n            <input type=\"text\" class=\"form-control\" name=\"name\" value=\"<%= name %>\" required autofocus disabled>\n          </div>\n        </div>\n        <div class=\"form-group\">\n          <label class=\"col-sm-2 for=\"owner\">Owner</label>\n          <div class=\"col-sm-10 owner\">\n            <input type=\"text\" class=\"form-control\" name=\"owner\" value=\"<%= owner.firstName %> <%= owner.lastName %>\" required autofocus disabled>\n          </div>\n        </div>\n        <div class=\"form-group\">\n          <label class=\"col-sm-2 for=\"priority\">Priority</label>\n          <div class=\"col-sm-10\">\n            <input type=\"number\" class=\"form-control\" name=\"priority\" value=\"<%= priority %>\" required>\n          </div>\n        </div>\n        <div class=\"form-group\">\n          <div class=\"col-sm-2 col-sm-offset-9\">\n          <button type=\"submit\" class=\"form-control btn btn-primary\">Update</button>\n          </div>\n        </div>\n      </form>\n    </div>\n  </div>\n</div>");
	
	  ProjectEditView.prototype.className = "container wide project-administration";
	
	  ProjectEditView.prototype.events = {
	    "submit form": "submitForm"
	  };
	
	  ProjectEditView.prototype.ui = {
	    "form": "form"
	  };
	
	  ProjectEditView.prototype.initialize = function() {
	    this.listenTo(this.model, "sync", this.render);
	    return this.model.fetch();
	  };
	
	  ProjectEditView.prototype.submitForm = function(event) {
	    var formValues;
	    event.preventDefault();
	    if (!this.ui.form[0].checkValidity()) {
	      Toast.error("Please supply all needed values.");
	      return;
	    }
	    formValues = FormSyphon.serialize(this.ui.form);
	    formValues.owner = this.model.get("owner").id;
	    return this.model.save(formValues).then(function() {}, Toast.success("Saved!"), app.router.loadURL("/projects#" + (this.model.get("name"))));
	  };
	
	  return ProjectEditView;
	
	})(Marionette.LayoutView);
	
	module.exports = ProjectEditView;


/***/ }

});
//# sourceMappingURL=21.21.js.map