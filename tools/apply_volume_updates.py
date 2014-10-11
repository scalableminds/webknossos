#!/usr/bin/python

import random
import os
import re
import shutil

update_regex = '^.*Volume update: VolumeUpdate\(.*DataLayer\(%s.*([0-9]),Cuboid\(32,32,32,1,Some\(\(([0-9]*)\.0, ([0-9]*)\.0, ([0-9]*)\.0.*userBinaryData/logging/(.*)\)'
filename_regex = '^(.*)/[0-9]*/x[0-9]*/y[0-9]*/z[0-9]*/(.*)_mag[0-9]*_x[0-9]*_y[0-9]*_z[0-9]*.raw'
dest_filename = '%s/%i/x%04i/y%04i/z%04i/%s_mag%i_x%04i_y%04i_z%04i.raw_%i%i%i'

def generate_test_cube(bpe):
  return bytearray(range(256) * 128 * 64 * bpe)

def cube_to_buckets(cube):
  bpe = len(cube) / 128**3
  buckets = [[] for n in xrange(64)]
  offset = 0
  for z in range(128):
    for y in range(128):
      for x in range(4):
        buckets[z / 32 * 16 + y / 32 * 4 + x].append(cube[offset:offset + 32 * bpe])
        offset += 32 * bpe

  return map(lambda b: bytearray().join(b), buckets)

def buckets_to_cube(buckets):
  bpe = len(buckets[0]) / 32**3
  cube = []
  for z in range(128):
    for y in range(128):
      for x in range(4):
        offset = (32 * (y % 32) + 32**2 * (z % 32)) * bpe
        cube.append(buckets[z / 32 * 16 + y / 32 * 4 + x][offset:offset + 32 * bpe])

  return bytearray().join(cube)

def bucket_filename(filename, index):
  return '%s_%i%i%i' % (filename, index % 4, (index / 4) % 4, index / 16)

def clear_raw(filename):
  size = 0
  with open(filename, 'rb') as raw:
    size = len(raw.read())
  with open(filename, 'wb') as raw:
    raw.write(bytearray(size))

def split_raw(filename):
  print("Splitting %s" % filename)
  with open(filename, 'rb') as raw:
    cube = bytearray(raw.read())
    buckets = cube_to_buckets(cube)
    for i, bucket in enumerate(buckets):
      with open(bucket_filename(filename, i), 'wb+') as raw_:
        raw_.write(bucket)
  os.remove(filename)

def merge_raw(filename):
  
  def load_bucket(index):
    bucket_file = bucket_filename(filename, index)
    with open(bucket_file, 'rb') as raw_:
      result = bytearray(raw_.read())
    os.remove(bucket_file)
    return result

  print("Merging %s" % filename)
  buckets = map(load_bucket, xrange(64))
  cube = buckets_to_cube(buckets)

  with open(filename, 'wb+') as raw:
    raw.write(cube)

def clear(rootDir):
  raw_files = filter(lambda f: f.endswith('.raw'), [f for (path,_,files) in os.walk(rootDir) for f in map(lambda f: path + '/' + f, files)])
  map(clear_raw, raw_files)

def combine(filename_a, filename_b):
  with open(filename_a, 'rb') as file_a:
    data_a = bytearray(file_a.read())

  with open(filename_b, 'rb') as file_b:
    data_b = bytearray(file_b.read())

  bpe = len(data_a) / 32**3

  for i in xrange(32**3):
    if data_a[i * bpe] + data_a[i * bpe] == 0:
      if data_b[i * bpe] + data_b[i * bpe] != 0:
        data_a[i * bpe] = data_b[i * bpe]
        data_a[i * bpe + 1] = data_b[i * bpe + 1]

  with open(filename_b, 'wb') as file_b:
    file_b.write(data_a)

def replace(filename_a, filename_b):
  shutil.copyfile(filename_a, filename_b)

def apply_updates(rootDir, layer, logfile, combine_func):
  loggingDir = rootDir + '/userBinaryData/logging/'
  layerDir = rootDir + '/userBinaryData/' + layer + '/'

  raw_files = filter(lambda f: f.endswith('.raw'), [f for (path,_,files) in os.walk(layerDir) for f in map(lambda f: path + '/' + f, files)])
  map(split_raw, raw_files)

  match = re.search(filename_regex, raw_files[0])
  baseDir = match.group(1)
  dataSet = match.group(2)

  with open(logfile, 'r') as log:
    for line in log:
      match = re.search(update_regex % layer, line)
      if match:
        mag = int(match.group(1))
        x = int(match.group(2))
        y = int(match.group(3))
        z = int(match.group(4))
        source = loggingDir + match.group(5)
        dest = dest_filename % (baseDir, mag, x / 128, y / 128, z / 128, dataSet, mag, x / 128, y / 128, z / 128, (x % 128) / 32, (y % 128) / 32, (z % 128) / 32)
        print("Combining %s and %s" % (source, dest))
        combine_func(source, dest)

#  raw_files = map(lambda f: f[:-4], filter(lambda f: f.endswith('.raw_000'), [f for (path,_,files) in os.walk(layerDir) for f in map(lambda f: path + '/' + f, files)]))
#  map(merge_raw, raw_files)

# Parameters
# rootDir: the script expects "userBinaryData" to be a subfolder of rootDir. The "userBinaryData" folder should contain the layer and the logging folder.
# layer: name of userDataLayer that will be restored in-place
# logfile: localtion of oxalis logfile relative to working directory
# combine_func: either "combine" to merge files or "replace" to take the newer file

rootDir = '.'
layer = '43a39e5f-c9aa-49d0-814c-a1389ce4efb4'
logfile = 'oxalis-tiny.log'

apply_updates(rootDir, layer, logfile, combine)
