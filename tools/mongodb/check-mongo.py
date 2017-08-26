import bson
import sets
import os

root = "."

constraints = [
  ("Datasets in volumeTracings should exist", "dataSets.name", "volumes.dataSetName"),
]

def bson_files(root):
  for root, dirs, files in os.walk('.', followlinks=True):
    for file in files:
      if file.endswith(".bson"):
        print "Reading data from '%s' ..." % file,
        yield os.path.join(root, file)
        print " Done."

def process_document(id, key, doc):
  if type(doc) == dict:
    for k in doc:
      process_document(id, key + "." + k, doc[k])
  elif type(doc) == list:
    for v in doc:
      process_document(id, key + "[]", v)
  else:
    if key in keys:
      if not doc in data[key]:
        data[key][doc] = []
      data[key][doc].append(id)

# Initialization
keys = sets.Set(map(lambda c: c[1], constraints) + map(lambda c: c[2], constraints))
data = {}
for key in keys:
  data[key] = {}

# Read documents
for bson_file in bson_files(root):
  collection = os.path.basename(bson_file).replace(".bson", "")
  with open(bson_file, "rb") as file:
    for document in bson.decode_all(file.read()):
      id = document["_id"]
      process_document(id, collection, document)

# Check constraints
exit_code = 0
for name, left, right in constraints:
  missing_values = sets.Set(data[right].keys()).difference(sets.Set(data[left].keys()))
  for value in missing_values:
    exit_code = 1
    for violated_document in data[right][value]:
      print >> sys.stderr, "Constraint '%s' violated on document '%s': value '%s' from '%s' not found in '%s'" % (name, violated_document, value, right, left), out=std.err

exit(exit_code)
