({
  mainConfigFile : ".tmp/javascripts/require-config.js",
  baseUrl : ".tmp/javascripts",
  modules : [
    {
      name : "main",
      wrap : {
        startFile : [ ".tmp/javascripts/require-config.js", ".tmp/javascripts/libs/require-2.1.1.js" ]
      }
    }, {
      name : "oxalis/controller"
    }, {
      name : "admin/views/user/user_list_view"
    }, {
      name : "ace"
    }
  ],
  dir : "public/javascripts/min",
  removeCombined: true,
  skipDirOptimize: true,
  optimize : "uglify2",
  // generateSourceMaps : true,
  // preserveLicenseComments : false,
  paths : {
    "routes": "empty:"
  }
})