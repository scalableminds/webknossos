// Update to support new tracing modes

// --- !Ups
db.skeletons.find().forEach(function(elem){
    modes = elem.settings.allowedModes;
    if(~modes.indexOf("arbitrary"))
      elem.settings.allowedModes = ["oblique", "flight"];
    else
      elem.settings.allowedModes = [];
    db.skeletons.save(elem);
})

// --- !Downs
db.skeletons.find().forEach(function(elem){
    modes = elem.settings.allowedModes;
    if((~modes.indexOf("oblique")) || (~modes.indexOf("flight")))
      elem.settings.allowedModes = ["oxalis", "arbitrary"];
    else
      elem.settings.allowedModes = ["oxalis"];
    db.skeletons.save(elem);
});
