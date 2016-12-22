_              = require("lodash")
Backbone       = require("backbone")

class DatastoreModel extends Backbone.Model

  urlRoot : "/api/datastores"
  idAttribute : "url"

module.exports = DatastoreModel
