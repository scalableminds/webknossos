// Update to support new dataset settings

// --- !Ups
db.users.find().forEach(function(elem){
    settings = elem.configuration.settings.brightnessContrastSettings;
    for(dataset in settings) {
      if(dataset != "default") {
        settings[dataset] = {color: settings[dataset]};
      }
    }
    elem.configuration.settings.brightnessContrastColorSettings = elem.configuration.settings.brightnessContrastSettings;
    delete elem.configuration.settings.brightnessContrastSettings;
    db.users.save(elem);
})

// --- !Downs
db.users.find().forEach(function(elem){
    settings = elem.configuration.settings.brightnessContrastColorSettings;
    for(dataset in settings) {
      if(dataset != "default") {
        keys = [];
        for(key in settings[dataset]) {
          keys.push(key);
        }
        settings[dataset] = settings[dataset][keys[0]];
      }
    }
    elem.configuration.settings.brightnessContrastSettings = elem.configuration.settings.brightnessContrastColorSettings;
    delete elem.configuration.settings.brightnessContrastColorSettings;
    db.users.save(elem);
})


