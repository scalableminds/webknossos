SortedCollection     = require("../sorted_collection")
DatastoreModel       = require("./datastore_model")

class DatastoreCollection extends SortedCollection

  url : "/api/datastores"
  model : DatastoreModel
  sortAttribute : "name"

module.exports = DatastoreCollection
