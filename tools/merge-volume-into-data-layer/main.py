from argparse import ArgumentParser
import zipfile
import shutil
import os
import random
import string
import wkw
import numpy as np
import re
from operator import add

def main():
    args = create_parser().parse_args()

    #tmpdir_path = tmp_filename()
    #os.makedirs(tmpdir_path)
#
    #extract_zip(args.tracing_path, tmpdir_path)
    tmpdir_path = 'tmp-67X8KZUFP0'

    tracing_dataset = wkw.Dataset.open(os.path.join(tmpdir_path, '1'))
    segmentation_dataset = wkw.Dataset.open(os.path.join(args.segmentation_path))

    tracing_bboxes = file_bboxes(tracing_dataset)
    segmentation_bboxes = file_bboxes(segmentation_dataset)
    print(tracing_bboxes)
    print(segmentation_bboxes)

    # todo: group tracing_bboxes by matching segmentation_bbox, iterate
    # todo: assert same byteness

    print("reading wkw file...")
    data = segmentation_dataset.read(segmentation_bboxes[0][0], segmentation_bboxes[0][1])

    print("overwriting tracing buckets in memory...")
    for tracing_bbox in tracing_bboxes:
        print("overwriting", tracing_bbox)
        tracing_data = tracing_dataset.read(tracing_bbox[0], tracing_bbox[1])
        print("tracing_data shape:", tracing_data.shape)
        topleft = tracing_bbox[0]
        shape = tracing_bbox[1]
        bottomright = list( map(add, topleft, shape) )
        print("broatcasting to 0:1 {}:{}, {}:{}, {}:{}".format(topleft[0], bottomright[0], topleft[1], bottomright[1], topleft[2], bottomright[2]))
        data[0:1, topleft[0]:bottomright[0], topleft[1]:bottomright[1], topleft[2]:bottomright[2]] = tracing_data

    print("writing wkw file back to disk...")
    segmentation_dataset.write([0, 0, 0], data)


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


def extract_zip(path, tmpdir_path):
    with zipfile.ZipFile(path) as outer_zip:
        if 'data.zip' in outer_zip.namelist():
            outfile_path = os.path.join(tmpdir_path, 'data.zip')
            with outer_zip.open('data.zip') as data_zip, open(outfile_path, 'wb') as outfile:
                shutil.copyfileobj(data_zip, outfile)
                read_data_zip(outfile_path, tmpdir_path)
            os.remove(outfile_path)
        else:
            read_data_zip(args.tracing_path)

def read_data_zip(path, tmpdir_path):
    with zipfile.ZipFile(path) as file:
        zipfile.ZipFile.extractall(file, path=tmpdir_path)

def create_parser():

    parser = ArgumentParser()

    parser.add_argument('tracing_path', help='Volume tracing zip file')

    parser.add_argument('segmentation_path', help='Directory containing the segmentation to overwrite.')

    return parser

def tmp_filename():
    return 'tmp-' + ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(10))

if __name__ == '__main__':
    main()
