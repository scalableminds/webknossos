PaginationCollection = require("../pagination_collection")

class UserCollection extends PaginationCollection

  url : "/api/users"
  sortAttribute : "firstName"

  state :
    pageSize : 50

module.exports = UserCollection
