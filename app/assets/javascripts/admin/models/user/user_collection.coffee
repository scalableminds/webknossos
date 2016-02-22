PaginationCollection = require("../pagination_collection")

class UserCollection extends PaginationCollection

  url : "/api/users"
  sortBy : "firstName"

  state :
    pageSize : 50

module.exports = UserCollection
