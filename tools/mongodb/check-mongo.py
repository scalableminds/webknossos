from __future__ import print_function
import bson
import os
import sys

constraints = [
  ("Datasets in volumeTracings should exist", "dataSets[].name", "volumes[].dataSetName"),
]

def bson_files(root):
  for root, dirs, files in os.walk(root, followlinks=True):
    for file in files:
      if file.endswith(".bson"):
        print("Reading data from '%s' ..." % file, end="")
        yield os.path.join(root, file)
        print(" Done.")

def process_document(id, key, doc, value_sets):
  if type(doc) == dict:
    for k in doc:
      process_document(id, key + "." + k, doc[k], value_sets)
  elif type(doc) == list:
    for v in doc:
      process_document(id, key + "[]", v, value_sets)
  else:
    if key in value_sets:
      value_set = value_sets[key]
      if not doc in value_set:
        value_set[doc] = []
      value_set[doc].append(id)

def main(root, constraints):
  # Initialization
  value_sets = {}
  for key in set(map(lambda c: c[1], constraints) + map(lambda c: c[2], constraints)):
    value_sets[key] = {}

  # Read documents
  for bson_file in bson_files(root):
    collection = os.path.basename(bson_file).replace(".bson", "[]")
    with open(bson_file, "rb") as file:
      for document in bson.decode_all(file.read()):
        id = document["_id"]
        process_document(id, collection, document, value_sets)

  # Check constraints
  exit_code = 0
  for name, left, right in constraints:
    missing_values = set(value_sets[right].keys()).difference(set(value_sets[left].keys()))
    for value in missing_values:
      exit_code = 1
      for violated_document in value_sets[right][value]:
        print("Constraint '%s' violated for document '%s': value '%s' from '%s' not found in '%s'" % (name, violated_document, value, right, left), file=sys.stderr)

  exit(exit_code)

if __name__ == "__main__":
  main(sys.argv[1], constraints)
