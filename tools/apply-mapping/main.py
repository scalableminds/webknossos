#!/usr/bin/env python3

from argparse import ArgumentParser
import zipfile
import shutil
import os
import random
import string
import wkw
import numpy as np
import re
import json
import itertools

data_zip_filename = 'data.zip'
data_zip_dirname = 'data_zip'

def main():
    args = create_parser().parse_args()

    mapping = read_mapping(args)

    tracing_tmpdir_path = extract_tracing_zip(args)
    tracing_dataset = wkw.Dataset.open(os.path.join(os.path.join(tracing_tmpdir_path, data_zip_dirname), '1'))
    tracing_bboxes = file_bboxes(tracing_dataset)

    print("Found {} tracing files".format(len(tracing_bboxes)))

    dtype = tracing_dataset.header.voxel_type

    def apply_mapping_to_voxel(voxel):
        voxel_str = str(voxel)
        if voxel_str in mapping:
            return parse_to_dtype(mapping[voxel_str])
        else:
            return voxel

    def parse_to_dtype(string):
        if dtype == np.uint64:
            return np.uint64(string)
        if dtype == np.uint32:
            return np.uint32(string)
        if dtype == np.uint16:
            return np.uint16(string)
        if dtype == np.uint8:
            return np.uint8(string)
        raise Exception("Unsupported data type in tracing: ", dtype)

    def is_mapped(voxel):
        return str(voxel) in mapping

    changed_count = 0

    for counter, tracing_bbox in enumerate(tracing_bboxes):
        print("Processing tracing file {} of {}, bounding box: {}...".format(counter+1, len(tracing_bboxes), tracing_bbox))
        data = tracing_dataset.read(tracing_bbox[0], tracing_bbox[1])
        transformed = np.vectorize(apply_mapping_to_voxel)(data)
        tracing_dataset.write(tracing_bbox[0], transformed)
        changed_count += np.count_nonzero(np.vectorize(is_mapped)(data))

    print("Changed {} Voxels".format(changed_count))
    pack_tracing_zip(tracing_tmpdir_path, args.tracing_path)
    print("Done")

def read_mapping(args):
    if not (args.mapping_path or args.mapping_str):
        raise Exception("""No mapping supplied, please add a mapping string in the format '{"7":"3", "12":"3"}' or a mapping file path via -f my_mapping.json""")

    if (args.mapping_path and args.mapping_str):
        print("Warning: both mapping string and mapping file path were supplied, ignoring the file.")

    if (args.mapping_str):
        mapping = json.loads(args.mapping_str)
    else:
        with open(args.mapping_path) as mapping_file:
            mapping = json.load(mapping_file)
    print_mapping_clipped(mapping)
    return mapping

def print_mapping_clipped(mapping):
    print("Using mapping: ", end='')
    max_entries = 5
    for k,v in list(itertools.islice(mapping.items(), max_entries)):
        print("{}->{} ".format(k,v), sep='',end='')
    if len(mapping) > max_entries:
        print("... ({} more)".format(len(mapping) - max_entries))
    else:
        print("")

def extract_tracing_zip(args):
    tracing_tmpdir_path = tmp_filename()
    os.makedirs(tracing_tmpdir_path)
    with zipfile.ZipFile(args.tracing_path) as outer_zip:
        zipfile.ZipFile.extractall(outer_zip, path=tracing_tmpdir_path)
    with zipfile.ZipFile(os.path.join(tracing_tmpdir_path, data_zip_filename)) as data_zip:
        zipfile.ZipFile.extractall(data_zip, path=os.path.join(tracing_tmpdir_path, data_zip_dirname))
    return tracing_tmpdir_path

def pack_tracing_zip(tracing_tmpdir_path, tracing_path):
    os.remove(os.path.join(tracing_tmpdir_path, data_zip_filename))
    zip_dir(os.path.join(tracing_tmpdir_path, data_zip_dirname), os.path.join(tracing_tmpdir_path, data_zip_filename))
    shutil.rmtree(os.path.join(tracing_tmpdir_path, data_zip_dirname))
    outfile_path = "{0}_mapped{1}".format(*os.path.splitext(tracing_path))
    zip_dir(os.path.join(tracing_tmpdir_path), outfile_path)
    print("Wrote", outfile_path)
    shutil.rmtree(tracing_tmpdir_path)

def zip_dir(dir_path, outfile_path):
    zip_file = zipfile.ZipFile(outfile_path, 'w', zipfile.ZIP_DEFLATED)
    for root, dirs, files in os.walk(dir_path):
        for file in files:
            zip_file.write(os.path.join(root, file), os.path.relpath(os.path.join(root, file), dir_path))
    zip_file.close()

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
    parser.add_argument('-f', action='store', dest='mapping_path', help='JSON file containing a direct mapping (e.g. {"7":"3", "12":"3"})')
    parser.add_argument('mapping_str', nargs='?')
    return parser

def tmp_filename():
    return 'tmp-' + ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(10))

if __name__ == '__main__':
    main()
