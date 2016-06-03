PaginationCollection = require("../pagination_collection")

class PaginatedUserCollection extends PaginationCollection

  url : "/api/users"
  sortAttribute : "firstName"

  state :
    pageSize : 50

module.exports = PaginatedUserCollection
