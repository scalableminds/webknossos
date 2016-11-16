SortedCollection = require("../sorted_collection")

class UserCollection extends SortedCollection

  url : "/api/users"
  sortAttribute : "firstName"

module.exports = UserCollection
