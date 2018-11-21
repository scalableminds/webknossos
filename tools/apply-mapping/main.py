#!/usr/bin/env python3

from argparse import ArgumentParser
import zipfile
import shutil
import os
import sys
import random
import string
import wkw
import numpy as np
import re
import json
from operator import add

def main():
    args = create_parser().parse_args()
    tracing_tmpdir_path = extract_tracing_zip(args)

    tracing_dataset = wkw.Dataset.open(os.path.join(os.path.join(tracing_tmpdir_path, 'data_zip'), '1'))
    with open(args.mapping_path) as mapping_file:
        mapping = json.load(mapping_file)
    print(mapping)

    tracing_bboxes = file_bboxes(tracing_dataset)

    print("Found {} tracing files".format(len(tracing_bboxes)))

    def apply_maping_to_voxel(voxel):
        voxel_str = str(voxel)
        if voxel_str in mapping:
            return np.uint32(mapping[voxel_str])
        else:
            return voxel

    for counter, tracing_bbox in enumerate(tracing_bboxes):
        print("Reading tracing file {} of {}, bounding box: {}...".format(counter+1, len(tracing_bboxes), tracing_bbox))
        data = tracing_dataset.read(tracing_bbox[0], tracing_bbox[1])
        print(data.shape)
        for point in data:
            print(point)
        transformed = np.vectorize(apply_maping_to_voxel)(data)
        print("mapped:")
        for point in transformed:
            print(point)
        tracing_dataset.write(tracing_bbox[0], transformed)

    pack_tracing_zip(tracing_tmpdir_path)
    print("Done.")


def extract_tracing_zip(args):
    tracing_tmpdir_path = tmp_filename()
    os.makedirs(tracing_tmpdir_path)
    with zipfile.ZipFile(args.tracing_path) as outer_zip:
        zipfile.ZipFile.extractall(outer_zip, path=tracing_tmpdir_path)
    with zipfile.ZipFile(os.path.join(tracing_tmpdir_path, 'data.zip')) as data_zip:
        zipfile.ZipFile.extractall(data_zip, path=os.path.join(tracing_tmpdir_path, 'data_zip'))
    return tracing_tmpdir_path

def pack_tracing_zip(tracing_tmpdir_path):
    os.remove(os.path.join(tracing_tmpdir_path, 'data.zip'))
    zip_dir(os.path.join(tracing_tmpdir_path, 'data_zip'), os.path.join(tracing_tmpdir_path, 'data.zip'))
    shutil.rmtree(os.path.join(tracing_tmpdir_path, 'data_zip'))

def zip_dir(dir_path, outfile_path):
    zip_file = zipfile.ZipFile(outfile_path, 'w', zipfile.ZIP_DEFLATED)
    for root, dirs, files in os.walk(dir_path):
        print("ROOOT:", root)
        print("dirs:", dirs)
        for file in files:
            zip_file.write(os.path.join(root, file), os.path.relpath(os.path.join(root, file), dir_path))
    zip_file.close()

def group_tracing_bboxes(tracing_bboxes, segmentation_bboxes):
    grouped = {}
    for tracing_bbox in tracing_bboxes:
        segmentation_bbox = matching_segmentation_bbox(segmentation_bboxes, tracing_bbox)
        if not str(segmentation_bbox) in grouped:
            grouped[str(segmentation_bbox)] = (segmentation_bbox, [])
        grouped[str(segmentation_bbox)][1].append(tracing_bbox)
    return grouped

def matching_segmentation_bbox(segmentation_bboxes, tracing_bbox):
    for segmentation_bbox in segmentation_bboxes:
        if     (segmentation_bbox[0][0] <= tracing_bbox[0][0]
            and segmentation_bbox[0][1] <= tracing_bbox[0][1]
            and segmentation_bbox[0][2] <= tracing_bbox[0][2]
            and segmentation_bbox[1][0] >= tracing_bbox[1][0]
            and segmentation_bbox[1][1] >= tracing_bbox[1][1]
            and segmentation_bbox[1][2] >= tracing_bbox[1][2]):
                return segmentation_bbox
    print("Error: tracing extends outside of segmentation data. Stopping, no data was modified.")
    sys.exit(1)

def file_bboxes(dataset):
    file_len_voxels = dataset.header.block_len * dataset.header.file_len
    p = re.compile('(.*)/z([0-9]+)/y([0-9]+)/x([0-9]+).wkw')
    bboxes = []
    for file in dataset.list_files():
        m = p.match(file)
        file_coords = [m.group(4), m.group(3), m.group(2)]
        offset = [int(x) * file_len_voxels for x in file_coords]
        shape = [file_len_voxels, file_len_voxels, file_len_voxels]
        bboxes.append((offset, shape))
    return bboxes

def create_parser():
    parser = ArgumentParser()
    parser.add_argument('tracing_path', help='Volume tracing zip file')
    parser.add_argument('mapping_path', help='JSON file containing a direct mapping (e.g. {"7":"3", "12":"3"})')
    return parser

def tmp_filename():
    return 'tmp-' + ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(10))

if __name__ == '__main__':
    main()
