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
from operator import add

def main():
    args = create_parser().parse_args()
    confirmation_prompt(args)
    tracing_tmpdir_path = extract_tracing_zip(args)

    tracing_dataset = wkw.Dataset.open(os.path.join(tracing_tmpdir_path, '1'))
    segmentation_dataset = wkw.Dataset.open(os.path.join(args.segmentation_path, '1'))

    assert(tracing_dataset.header.num_channels == segmentation_dataset.header.num_channels)
    assert(tracing_dataset.header.voxel_type == segmentation_dataset.header.voxel_type)

    tracing_bboxes = file_bboxes(tracing_dataset)
    segmentation_bboxes = file_bboxes(segmentation_dataset)

    bboxes_grouped = group_tracing_bboxes(tracing_bboxes, segmentation_bboxes)

    print("Found {} tracing files, which will affect {} segmentation files".format(len(tracing_bboxes), len(bboxes_grouped)))

    segmentation_file_len_voxels = segmentation_dataset.header.block_len * segmentation_dataset.header.file_len

    for counter, bbox_group_key in enumerate(bboxes_grouped):
        segmentation_bbox = bboxes_grouped[bbox_group_key][0]
        tracing_bboxes = bboxes_grouped[bbox_group_key][1]

        print("Reading segmentation file {} of {}, bounding box: {}...".format(counter+1, len(bboxes_grouped), segmentation_bbox))
        data = segmentation_dataset.read(segmentation_bbox[0], segmentation_bbox[1])

        print("  Overwriting tracing buckets in memory...")
        for tracing_bbox in tracing_bboxes:
            print("    Overwriting", tracing_bbox)
            tracing_data = tracing_dataset.read(tracing_bbox[0], tracing_bbox[1])
            topleft = list(map(lambda x: x % segmentation_file_len_voxels, tracing_bbox[0]))
            shape = tracing_bbox[1]
            bottomright = list( map(add, topleft, shape) )
            data[0:1, topleft[0]:bottomright[0], topleft[1]:bottomright[1], topleft[2]:bottomright[2]] = tracing_data

        print("  Writing segmentation file back to disk...")
        segmentation_dataset.write([0, 0, 0], data)
    print("Cleaning up temporary files...")
    shutil.rmtree(tracing_tmpdir_path)
    print("Done.")

def confirmation_prompt(args):
    if not args.yes:
        answer = input("Are you sure you want to modify the data in {}? This cannot be undone. To continue, type “yes”: ".format(args.segmentation_path))
        if answer != "yes":
            print("Aborting")
            sys.exit(0)

def extract_tracing_zip(args):
    tracing_tmpdir_path = tmp_filename()
    os.makedirs(tracing_tmpdir_path)
    with zipfile.ZipFile(args.tracing_path) as outer_zip:
        if 'data.zip' in outer_zip.namelist():
            outfile_path = os.path.join(tracing_tmpdir_path, 'data.zip')
            with outer_zip.open('data.zip') as data_zip, open(outfile_path, 'wb') as outfile:
                shutil.copyfileobj(data_zip, outfile)
                extract_data_zip(outfile_path, tracing_tmpdir_path)
            os.remove(outfile_path)
        else:
            extract_data_zip(args.tracing_path)
    return tracing_tmpdir_path

def extract_data_zip(path, tracing_tmpdir_path):
    with zipfile.ZipFile(path) as file:
        zipfile.ZipFile.extractall(file, path=tracing_tmpdir_path)

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
    parser.add_argument('segmentation_path', help='Directory containing the segmentation to overwrite. (Path should not include zoom level)')
    parser.add_argument('-y', '--yes', action="store_true", help='Skip the confirmation prompt')
    return parser

def tmp_filename():
    return 'tmp-' + ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(10))

if __name__ == '__main__':
    main()
