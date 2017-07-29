#!/usr/bin/python

user = "<user>"
dataset = "2012-09-28_ex145_07x2_segNew"
filename = "2012-09-28_ex145_07x2"
layer = "color"
section = "."
X = [28, 29, 30]
Y = [21, 22, 23]
Z = [12]
R = [1]

cmd = "mkdir -p ./%s/%s/%d/x%04d/y%04d/z%04d/ && scp %s@oxalis.at:data/%s/%s/%s/%d/x%04d/y%04d/z%04d/%s_mag%d_x%04d_y%04d_z%04d.raw ./%s/%s/%d/x%04d/y%04d/z%04d/%s_mag%d_x%04d_y%04d_z%04d.raw"

for x in X:
  for y in Y:
    for z in Z:
      for r in R:
        x /= r
        y /= r
        z /= r
        print cmd % (layer, section, r, x, y, z, user, dataset, layer, section, r, x, y, z, filename, r, x, y, z, layer, section, r, x, y, z, dataset, r, x, y, z)
