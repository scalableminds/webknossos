// Update to support new tracing modes

// --- !Ups
db.skeletons.find().forEach(function(elem){
    modes = elem.settings.allowedModes;
    if(~modes.indexOf("arbitrary"))
      elem.settings.allowedModes = [];
    else
      elem.settings.allowedModes = ["oblique", "spherical"];
    db.skeletons.save(elem);
})

// --- !Downs
db.skeletons.find().forEach(function(elem){
    modes = elem.settings.allowedModes;
    if((~modes.indexOf("oblique")) || (~modes.indexOf("spherical")))
      elem.settings.allowedModes = ["oxalis", "arbitrary"];
    else
      elem.settings.allowedModes = ["oxalis"];
    db.skeletons.save(elem);
});
