unnecessaryKeys = [];
existKeys = [
  /* list of keys */
];
db.collection.find().forEach(function(doc) {
  keys = Object.keys(doc);
  tmpKeys = keys.filter(function(key) {
    return existKeys.indexOf(key) == -1;
  });
  tmpKeys.forEach(function(key) {
    index = unnecessaryKeys.indexOf(key);
    if (index == -1) unnecessaryKeys.push(key);
  });
});
print(unnecessaryKeys);
