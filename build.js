({
  mainConfigFile : "target/assets/public/javascripts_tmp/require_config.js",
  baseUrl : "target/assets/public/javascripts_tmp",
  modules : [
    {
      name : "main",
      include : [ "require", "require_config" ]
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
  
  dir : "target/assets/public/javascripts",
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