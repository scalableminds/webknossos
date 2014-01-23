### define
libs/dispatched_worker : DispatchedWorker
###

return {
  load : (name, parentRequire, load, config) ->

    load(new DispatchedWorker(parentRequire.toUrl(name)))
    return
}

