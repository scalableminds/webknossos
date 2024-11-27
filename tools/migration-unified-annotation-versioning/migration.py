import psycopg2
import psycopg2.extras
from psycopg2.extras import RealDictRow
import math
import logging
import datetime
import time
from typing import Dict, Tuple, List, Optional, Callable
from rich.progress import track
import msgspec
import concurrent.futures
import threading

import fossildbapi_pb2 as proto
import VolumeTracing_pb2 as Volume
import SkeletonTracing_pb2 as Skeleton
import Annotation_pb2 as AnnotationProto
from utils import log_since, batch_range
from connections import connect_to_fossildb, connect_to_postgres, assert_grpc_success

logger = logging.getLogger(__name__)


LayerVersionMapping = Dict[str, Dict[int, int]] # tracing id to (old version to new version)
MappingIdMap = Dict[str, str] # tracing id to editable mapping id


class Migration:

    def __init__(self, args):
        logger.info(f"Initializing migration with args {args} ...")
        self.args = args
        self.src_stub = connect_to_fossildb(args.src, "source")
        self.dst_stub = None
        if not args.dry:
            self.dst_stub = connect_to_fossildb(args.dst, "destination")
        self.json_encoder = msgspec.json.Encoder()
        self.json_decoder = msgspec.json.Decoder()
        self.done_count = None
        self.done_count_lock = threading.Lock()
        self.total_count = None

    def run(self):
        start_time = datetime.datetime.now()
        before = time.time()
        logger.info(f"Using start time {start_time}")
        annotations = self.read_annotation_list(start_time)
        self.done_count = 0
        self.total_count = len(annotations)

        before_submit = time.time()
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.args.num_threads) as executor:
            executor.map(self.migrate_annotation, annotations)
            log_since(before_submit, f"Submitting {self.total_count} futures to ThreadPoolExecutor via map")
        log_since(before, "Migrating all the things")

    def migrate_annotation(self, annotation):
        logger.info(f"Migrating annotation {annotation['_id']} ...")
        before = time.time()
        mapping_id_map = self.build_mapping_id_map(annotation)
        layer_version_mapping, latest_unified_version = self.migrate_updates(annotation, mapping_id_map)
        self.migrate_materialized_layers(annotation, layer_version_mapping, mapping_id_map)
        self.create_and_save_annotation_proto(annotation, latest_unified_version)
        with self.done_count_lock:
            self.done_count += 1
        log_since(before, "", self.get_progress())


    def build_mapping_id_map(self, annotation) -> MappingIdMap:
        mapping_id_map = {}
        for tracing_id, layer_type in annotation["layers"].items():
            if layer_type == "Volume":
                editable_mapping_id = self.get_editable_mapping_id(tracing_id, layer_type)
                if editable_mapping_id is not None:
                    mapping_id_map[tracing_id] = editable_mapping_id
        return mapping_id_map

    def migrate_updates(self, annotation, mapping_id_map: MappingIdMap) -> Tuple[LayerVersionMapping, int]:
        batch_size = 1000
        unified_version = 0
        version_mapping = {}
        for tracing_id, layer_type in annotation["layers"].items():
            collection = self.update_collection_for_layer_type(layer_type)
            version_mapping_for_layer = {0: 0}
            newest_version = self.get_newest_version(tracing_id, collection)
            for batch_start, batch_end in batch_range(newest_version, batch_size):
                update_groups = self.get_update_batch(tracing_id, collection, batch_start, batch_end)
                for version, update_group in update_groups:
                    update_group = self.process_update_group(tracing_id, layer_type, update_group)
                    unified_version += 1
                    version_mapping_for_layer[version] = unified_version
                    self.save_update_group(annotation['_id'], unified_version, update_group)
            version_mapping[tracing_id] = version_mapping_for_layer
            if tracing_id in mapping_id_map:
                editable_mapping_id = mapping_id_map[tracing_id]
                version_mapping_for_mapping = {0: 0}
                for batch_start, batch_end in batch_range(newest_version, batch_size):
                    mapping_update_groups = self.get_update_batch(editable_mapping_id, "editableMappingUpdates", batch_start, batch_end)
                    for version, update_group in mapping_update_groups:
                        unified_version += 1
                        version_mapping_for_mapping[version] = unified_version
                        self.save_update_group(annotation['_id'], unified_version, update_group)
                version_mapping[editable_mapping_id] = version_mapping_for_mapping

        # TODO interleave updates rather than concat
        # TODO handle existing revertToVersion update actions
        return version_mapping, unified_version

    def get_editable_mapping_id(self, tracing_id: str, layer_type: str) -> Optional[str]:
        if layer_type == "Skeleton":
            return None
        tracing_raw = self.get_newest_tracing_raw(tracing_id, "volumes")
        if tracing_raw is None:
            return None
        volume = Volume.VolumeTracing()
        volume.ParseFromString(tracing_raw)
        if volume.hasEditableMapping:
            return volume.mappingName
        return None

    def get_newest_tracing_raw(self, tracing_id, collection) -> Optional[bytes]:
        getReply = self.src_stub.Get(
            proto.GetRequest(collection=collection, key=tracing_id, mayBeEmpty=True)
        )
        if getReply.success:
            return getReply.value
        return None

    def process_update_group(self, tracing_id: str, layer_type: str, update_group_raw: bytes) -> bytes:
        update_group_parsed = self.json_decoder.decode(update_group_raw)

        # TODO handle existing revertToVersion update actions

        for update in update_group_parsed:
            name = update["name"]

            if name == "updateTracing":
                update["name"] = f"update{layer_type}Tracing"
            elif name == "updateUserBoundingBoxes":
                update["name"] = f"updateUserBoundingBoxesIn{layer_type}Tracing"
            elif name == "updateUserBoundingBoxVisibility":
                update["name"] = f"updateUserBoundingBoxVisibilityIn{layer_type}Tracing"

            if not name == "updateTdCamera":
                update["value"]["actionTracingId"] = tracing_id

        return self.json_encoder.encode(update_group_parsed)

    def save_update_group(self, annotation_id: str, version: int, update_group_raw: bytes) -> None:
        self.save_bytes(collection="annotationUpdates", key=annotation_id, version=version, value=update_group_raw)

    def get_newest_version(self, tracing_id: str, collection: str) -> int:
        getReply = self.src_stub.Get(
            proto.GetRequest(collection=collection, key=tracing_id, mayBeEmpty=True)
        )
        if getReply.success:
            return getReply.actualVersion
        return 0

    def get_update_batch(self, tracing_or_mapping_id: str, collection: str, batch_start: int, batch_end_inclusive: int) -> List[Tuple[int, bytes]]:
        reply = self.src_stub.GetMultipleVersions(
            proto.GetMultipleVersionsRequest(collection=collection, key=tracing_or_mapping_id, oldestVersion=batch_start, newestVersion=batch_end_inclusive)
        )
        assert_grpc_success(reply)
        reply.versions.reverse()
        reply.values.reverse()
        return list(zip(reply.versions, reply.values))

    def update_collection_for_layer_type(self, layer_type):
        if layer_type == "Skeleton":
            return "skeletonUpdates"
        return "volumeUpdates"

    def migrate_materialized_layers(self, annotation: RealDictRow, layer_version_mapping: LayerVersionMapping, mapping_id_map: MappingIdMap):
        for tracing_id, tracing_type in annotation["layers"].items():
            self.migrate_materialized_layer(tracing_id, tracing_type, layer_version_mapping, mapping_id_map)

    def migrate_materialized_layer(self, tracing_id: str, layer_type: str, layer_version_mapping: LayerVersionMapping, mapping_id_map: MappingIdMap):
        if layer_type == "Skeleton":
            self.migrate_skeleton_proto(tracing_id, layer_version_mapping)
        if layer_type == "Volume":
            self.migrate_volume_proto(tracing_id, layer_version_mapping)
            self.migrate_volume_buckets(tracing_id, layer_version_mapping)
            self.migrate_segment_index(tracing_id, layer_version_mapping)
            self.migrate_editable_mapping(tracing_id, layer_version_mapping, mapping_id_map)

    def migrate_skeleton_proto(self, tracing_id: str, layer_version_mapping: LayerVersionMapping):
        collection = "skeletons"
        materialized_versions = self.list_versions(collection, tracing_id)
        for materialized_version in materialized_versions:
            new_version = layer_version_mapping[tracing_id][materialized_version]
            value_bytes = self.get_bytes(collection, tracing_id, materialized_version)
            if materialized_version != new_version:
                skeleton = Skeleton.SkeletonTracing()
                skeleton.ParseFromString(value_bytes)
                skeleton.version = new_version
                value_bytes = skeleton.SerializeToString()
            self.save_bytes(collection, tracing_id, new_version, value_bytes)

    def migrate_volume_proto(self, tracing_id: str, layer_version_mapping: LayerVersionMapping):
        collection = "volumes"
        materialized_versions = self.list_versions(collection, tracing_id)
        for materialized_version in materialized_versions:
            new_version = layer_version_mapping[tracing_id][materialized_version]
            value_bytes = self.get_bytes(collection, tracing_id, materialized_version)
            if materialized_version != new_version:
                volume = Volume.VolumeTracing()
                volume.ParseFromString(value_bytes)
                volume.version = new_version
                value_bytes = volume.SerializeToString()
            self.save_bytes(collection, tracing_id, new_version, value_bytes)

    def list_versions(self, collection, key) -> List[int]:
        reply = self.src_stub.ListVersions(proto.ListVersionsRequest(collection=collection, key=key))
        assert_grpc_success(reply)
        return reply.versions

    def get_bytes(self, collection: str, key: str, version: int) -> bytes:
        reply = self.src_stub.Get(proto.GetRequest(collection=collection, key=key, version=version))
        assert_grpc_success(reply)
        return reply.value

    def save_bytes(self, collection: str, key: str, version: int, value: bytes) -> None:
        if self.dst_stub is not None:
            reply = self.dst_stub.Put(proto.PutRequest(collection=collection, key=key, version=version, value=value))
            assert_grpc_success(reply)

    def migrate_volume_buckets(self, tracing_id: str, layer_version_mapping: LayerVersionMapping):
        self.migrate_all_versions_and_keys_with_prefix("volumeData", tracing_id, layer_version_mapping, transform_key=self.remove_morton_index)

    def migrate_all_versions_and_keys_with_prefix(self, collection: str, tracing_id: str, layer_version_mapping: LayerVersionMapping, transform_key: Optional[Callable[[str], str]]):
        list_keys_page_size = 5000
        versions_page_size = 500
        current_start_after_key = tracing_id + "." # . is lexicographically before /
        newest_tracing_version = max(layer_version_mapping[tracing_id].keys())
        while True:
            list_keys_reply = self.src_stub.ListKeys(proto.ListKeysRequest(collection=collection, limit=list_keys_page_size, startAfterKey=current_start_after_key))
            assert_grpc_success(list_keys_reply)
            if len(list_keys_reply.keys) == 0:
                # We iterated towards the very end of the collection
                return
            for key in list_keys_reply.keys:
                if key.startswith(tracing_id):
                    for version_range_start, version_range_end in batch_range(newest_tracing_version, versions_page_size):
                        get_versions_reply = self.src_stub.GetMultipleVersions(proto.GetMultipleVersionsRequest(collection=collection, key=key, oldestVersion=version_range_start, newestVersion=version_range_end))
                        assert_grpc_success(get_versions_reply)
                        new_key = key
                        if transform_key is not None:
                            new_key = transform_key(key)
                        for version, value in zip(get_versions_reply.versions, get_versions_reply.values):
                            new_version = layer_version_mapping[tracing_id][version]
                            self.save_bytes(collection, new_key, new_version, value)
                    current_start_after_key = key
                else:
                    # We iterated past the elements of the current tracing
                    return

    def migrate_segment_index(self, tracing_id, layer_version_mapping):
        self.migrate_all_versions_and_keys_with_prefix("volumeSegmentIndex", tracing_id, layer_version_mapping, transform_key=None)

    def migrate_editable_mapping(self, tracing_id: str, layer_version_mapping: LayerVersionMapping, mapping_id_map: MappingIdMap):
        self.migrate_editable_mapping_info(tracing_id, layer_version_mapping, mapping_id_map)
        self.migrate_editable_mapping_agglomerate_to_graph(tracing_id, layer_version_mapping)
        self.migrate_editable_mapping_segment_to_agglomerate(tracing_id, layer_version_mapping)

    def migrate_editable_mapping_info(self, tracing_id: str, layer_version_mapping: LayerVersionMapping, mapping_id_map: MappingIdMap):
        if tracing_id not in mapping_id_map:
            return
        mapping_id = mapping_id_map[tracing_id]
        collection = "editableMappingsInfo"
        materialized_versions = self.list_versions(collection, mapping_id)
        for materialized_version in materialized_versions:
            value_bytes = self.get_bytes(collection, mapping_id, materialized_version)
            new_version = layer_version_mapping[mapping_id][materialized_version]
            self.save_bytes(collection, mapping_id, new_version, value_bytes)

    def migrate_editable_mapping_agglomerate_to_graph(self, tracing_id: str, layer_version_mapping: LayerVersionMapping):
        self.migrate_all_versions_and_keys_with_prefix(
            "editableMappingsAgglomerateToGraph",
            tracing_id,
            layer_version_mapping,
            None
        )

    def migrate_editable_mapping_segment_to_agglomerate(self, tracing_id: str, layer_version_mapping: LayerVersionMapping):
        self.migrate_all_versions_and_keys_with_prefix(
            "editableMappingsSegmentToAgglomerate",
            tracing_id,
            layer_version_mapping,
            None
        )

    def create_and_save_annotation_proto(self, annotation, latest_unified_version: int):
        version_step = 1000
        for version in range(0, latest_unified_version, version_step):
            annotationProto = AnnotationProto.AnnotationProto()
            annotationProto.name = annotation["name"]
            annotationProto.description = annotation["description"]
            annotationProto.version = version
            annotationProto.earliestAccessibleVersion = 0
            for tracing_id, tracing_type in annotation["layers"].items():
                layer_proto = AnnotationProto.AnnotationLayerProto()
                layer_proto.tracingId = tracing_id
                layer_proto.name = annotation["layernames"][tracing_id]
                layer_type_proto = AnnotationProto.AnnotationLayerTypeProto.Skeleton
                if tracing_type == "Volume":
                    layer_type_proto = AnnotationProto.AnnotationLayerTypeProto.Volume
                layer_proto.type = layer_type_proto
                annotationProto.annotationLayers.append(layer_proto)
            self.save_bytes(collection="annotations", key=annotation["_id"], version=version, value=annotationProto.SerializeToString())

    def read_annotation_list(self, start_time):
        before = time.time()
        logger.info("Determining annotation count from postgres...")
        page_size = 10000
        connection = connect_to_postgres(self.args.postgres)
        cursor = connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        modified_str = start_time.strftime("'%Y-%m-%d %H:%M:%S'")
        cursor.execute(f"SELECT COUNT(*) FROM webknossos.annotations WHERE modified < {modified_str}")
        annotation_count = cursor.fetchone()['count']
        logger.info(f"Loading infos of {annotation_count} annotations from postgres ...")
        annotations = []
        page_count = math.ceil(annotation_count / page_size)
        for page_num in track(range(page_count), total=page_count, description=f"Loading annotation infos ..."):
            query = f"""
                WITH annotations AS (
                    SELECT _id, name, description, created, modified FROM webknossos.annotations
                    WHERE modified < {modified_str}
                    ORDER BY _id
                    LIMIT {page_size}
                    OFFSET {page_size * page_num}
                )

                SELECT
                  a._id, a.name, a.description, a.created, a.modified,
                  JSON_OBJECT_AGG(al.tracingId, al.typ) AS layers,
                  JSON_OBJECT_AGG(al.tracingId, al.name) AS layerNames
                FROM webknossos.annotation_layers al
                JOIN annotations a on al._annotation = a._id
                GROUP BY a._id, a.name, a.description, a.created, a.modified
                """
            cursor.execute(query)
            annotations += cursor.fetchall()
        log_since(before, "Loading annotations")
        return annotations

    def remove_morton_index(self, bucket_key: str) -> str:
        first_slash_index = bucket_key.index('/')
        second_slash_index = bucket_key.index('/', first_slash_index + 1)
        first_bracket_index = bucket_key.index('[')
        return bucket_key[:second_slash_index + 1] + bucket_key[first_bracket_index:]

    def get_progress(self) -> str:
        with self.done_count_lock:
            done_count = self.done_count
        percentage = 100.0 * done_count / self.total_count
        return f". ({done_count}/{self.total_count}={percentage:.1f}% are done.)"
