// --- !Ups
db.dataSets.find({isActive: true}).forEach(function(e){
    var layers = e.dataSource.dataLayers;
    layers.forEach(function(l){
        l.mappings = l.mappings || [];
    });
    db.dataSets.update({_id: e._id}, e);
})
// --- !Downs
db.dataSets.find({isActive: true}).forEach(function(e){
    var layers = e.dataSource.dataLayers;
    layers.forEach(function(l){
        delete l.mappings;
    });
    db.dataSets.update({_id: e._id}, e);
})
