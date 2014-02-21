({
  mainConfigFile : "public/javascripts_tmp/require_config.js",
  baseUrl : "public/javascripts_tmp",
  modules : [
    {
      name : "main",
      override : {
        wrap : {
          startFile : [ "public/bower_components/requirejs/require.js", "public/javascripts_tmp/require_config.js" ]
        }
      }
    }, {
      name : "oxalis/controller",
      exclude : [ "main" ]
    }, {
      name : "admin/views/user/user_list_view",
      exclude : [ "main" ]
    }, {
      name : "ace"
    }
  ],
  
  dir : "public/javascripts",
  optimize : "none",
  removeCombined: true,
  skipDirOptimize: true,
  allowSourceOverwrites: true,
  generateSourceMaps : true,
  preserveLicenseComments : false,
  
  paths : {
    "routes": "empty:"
  }
})