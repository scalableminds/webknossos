# -*- coding: utf-8 -*-
# Generated by the protocol buffer compiler.  DO NOT EDIT!
# source: VolumeTracing.proto
"""Generated protocol buffer code."""
from google.protobuf.internal import builder as _builder
from google.protobuf import descriptor as _descriptor
from google.protobuf import descriptor_pool as _descriptor_pool
from google.protobuf import symbol_database as _symbol_database
# @@protoc_insertion_point(imports)

_sym_db = _symbol_database.Default()


import geometry_pb2 as geometry__pb2
import MetadataEntry_pb2 as MetadataEntry__pb2


DESCRIPTOR = _descriptor_pool.Default().AddSerializedFile(b'\n\x13VolumeTracing.proto\x12&com.scalableminds.webknossos.datastore\x1a\x0egeometry.proto\x1a\x13MetadataEntry.proto\"\xa0\x03\n\x07Segment\x12\x11\n\tsegmentId\x18\x01 \x02(\x03\x12L\n\x0e\x61nchorPosition\x18\x02 \x01(\x0b\x32\x34.com.scalableminds.webknossos.datastore.Vec3IntProto\x12\x0c\n\x04name\x18\x03 \x01(\t\x12\x14\n\x0c\x63reationTime\x18\x04 \x01(\x03\x12\x41\n\x05\x63olor\x18\x05 \x01(\x0b\x32\x32.com.scalableminds.webknossos.datastore.ColorProto\x12\x0f\n\x07groupId\x18\x06 \x01(\x05\x12n\n#anchorPositionAdditionalCoordinates\x18\x07 \x03(\x0b\x32\x41.com.scalableminds.webknossos.datastore.AdditionalCoordinateProto\x12L\n\x08metadata\x18\x0b \x03(\x0b\x32:.com.scalableminds.webknossos.datastore.MetadataEntryProto\"\x84\n\n\rVolumeTracing\x12\x17\n\x0f\x61\x63tiveSegmentId\x18\x01 \x01(\x03\x12M\n\x0b\x62oundingBox\x18\x02 \x02(\x0b\x32\x38.com.scalableminds.webknossos.datastore.BoundingBoxProto\x12\x18\n\x10\x63reatedTimestamp\x18\x03 \x02(\x03\x12\x13\n\x0b\x64\x61tasetName\x18\x04 \x02(\t\x12J\n\x0c\x65\x64itPosition\x18\x05 \x02(\x0b\x32\x34.com.scalableminds.webknossos.datastore.Vec3IntProto\x12M\n\x0c\x65\x64itRotation\x18\x06 \x02(\x0b\x32\x37.com.scalableminds.webknossos.datastore.Vec3DoubleProto\x12]\n\x0c\x65lementClass\x18\x07 \x02(\x0e\x32G.com.scalableminds.webknossos.datastore.VolumeTracing.ElementClassProto\x12\x15\n\rfallbackLayer\x18\x08 \x01(\t\x12\x18\n\x10largestSegmentId\x18\t \x01(\x03\x12\x0f\n\x07version\x18\n \x02(\x03\x12\x11\n\tzoomLevel\x18\x0b \x02(\x01\x12Q\n\x0fuserBoundingBox\x18\x0c \x01(\x0b\x32\x38.com.scalableminds.webknossos.datastore.BoundingBoxProto\x12X\n\x11userBoundingBoxes\x18\r \x03(\x0b\x32=.com.scalableminds.webknossos.datastore.NamedBoundingBoxProto\x12\x16\n\x0eorganizationId\x18\x0e \x01(\t\x12\x42\n\x04mags\x18\x0f \x03(\x0b\x32\x34.com.scalableminds.webknossos.datastore.Vec3IntProto\x12\x41\n\x08segments\x18\x10 \x03(\x0b\x32/.com.scalableminds.webknossos.datastore.Segment\x12\x13\n\x0bmappingName\x18\x11 \x01(\t\x12\x1a\n\x12hasEditableMapping\x18\x12 \x01(\x08\x12K\n\rsegmentGroups\x18\x13 \x03(\x0b\x32\x34.com.scalableminds.webknossos.datastore.SegmentGroup\x12\x17\n\x0fhasSegmentIndex\x18\x14 \x01(\x08\x12l\n!editPositionAdditionalCoordinates\x18\x15 \x03(\x0b\x32\x41.com.scalableminds.webknossos.datastore.AdditionalCoordinateProto\x12S\n\x0e\x61\x64\x64itionalAxes\x18\x16 \x03(\x0b\x32;.com.scalableminds.webknossos.datastore.AdditionalAxisProto\x12\x17\n\x0fmappingIsLocked\x18\x17 \x01(\x08\"N\n\x11\x45lementClassProto\x12\t\n\x05uint8\x10\x01\x12\n\n\x06uint16\x10\x02\x12\n\n\x06uint24\x10\x03\x12\n\n\x06uint32\x10\x04\x12\n\n\x06uint64\x10\x08\"\x89\x01\n\x0cSegmentGroup\x12\x0c\n\x04name\x18\x01 \x02(\t\x12\x0f\n\x07groupId\x18\x02 \x02(\x05\x12\x46\n\x08\x63hildren\x18\x03 \x03(\x0b\x32\x34.com.scalableminds.webknossos.datastore.SegmentGroup\x12\x12\n\nisExpanded\x18\x04 \x01(\x08\"Z\n\x10VolumeTracingOpt\x12\x46\n\x07tracing\x18\x01 \x01(\x0b\x32\x35.com.scalableminds.webknossos.datastore.VolumeTracing\"\\\n\x0eVolumeTracings\x12J\n\x08tracings\x18\x01 \x03(\x0b\x32\x38.com.scalableminds.webknossos.datastore.VolumeTracingOpt')

_builder.BuildMessageAndEnumDescriptors(DESCRIPTOR, globals())
_builder.BuildTopDescriptorsAndMessages(DESCRIPTOR, 'VolumeTracing_pb2', globals())
if _descriptor._USE_C_DESCRIPTORS == False:

  DESCRIPTOR._options = None
  _SEGMENT._serialized_start=101
  _SEGMENT._serialized_end=517
  _VOLUMETRACING._serialized_start=520
  _VOLUMETRACING._serialized_end=1804
  _VOLUMETRACING_ELEMENTCLASSPROTO._serialized_start=1726
  _VOLUMETRACING_ELEMENTCLASSPROTO._serialized_end=1804
  _SEGMENTGROUP._serialized_start=1807
  _SEGMENTGROUP._serialized_end=1944
  _VOLUMETRACINGOPT._serialized_start=1946
  _VOLUMETRACINGOPT._serialized_end=2036
  _VOLUMETRACINGS._serialized_start=2038
  _VOLUMETRACINGS._serialized_end=2130
# @@protoc_insertion_point(module_scope)