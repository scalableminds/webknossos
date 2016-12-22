Backbone       = require("backbone")
DatastoreModel = require("./datastore_model")

class DatastoreCollection extends Backbone.Collection

  url : "/api/datastores"
  model : DatastoreModel

module.exports = DatastoreCollection
