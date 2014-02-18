({
  mainConfigFile : ".tmp/javascripts/require_config.js",
  baseUrl : ".tmp/javascripts",
  modules : [
    {
      name : "main",
      include : [ "require", "require_config" ]
    }, {
      name : "oxalis/controller",
      paths : {
        "jquery" : "empty:",
        "underscore" : "empty:",
        "backbone" : "empty:"
      }
    }, {
      name : "admin/views/user/user_list_view"
    }, {
      name : "ace"
    }
  ],
  dir : "public/javascripts",
  removeCombined: true,
  skipDirOptimize: true,
  optimize : "uglify2",
  // generateSourceMaps : true,
  // preserveLicenseComments : false,
  paths : {
    "routes": "empty:"
  }
})