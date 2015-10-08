DispatchedWorker = require("../libs/dispatched_worker")

module.exports = {
  load : (name, parentRequire, load, config) ->

    load(new DispatchedWorker(parentRequire.toUrl(name)))
    return
}

