import psycopg2
import psycopg2.extras
from psycopg2.extras import RealDictRow
import math
import logging
import datetime
import time
from typing import Dict, Tuple, List, Optional, Callable, Set
from rich.progress import track
import msgspec
import concurrent.futures
import threading
from functools import partial
import heapq

import fossildbapi_pb2 as proto
import VolumeTracing_pb2 as Volume
import SkeletonTracing_pb2 as Skeleton
import Annotation_pb2 as AnnotationProto
from utils import log_since, batch_range, humanize_time_diff
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
        self.done_count = None
        self.done_count_lock = threading.Lock()
        self.failure_count = 0
        self.failure_count_lock = threading.Lock()
        self.total_count = None
        self.before = 0

    def run(self):
        self.before = time.time()
        annotations = self.read_annotation_list()
        self.done_count = 0
        self.failure_count = 0
        self.total_count = len(annotations)

        with concurrent.futures.ThreadPoolExecutor(max_workers=self.args.num_threads) as executor:
            executor.map(self.migrate_annotation, annotations)
        if self.failure_count > 0:
            logger.info(f"There were failures for {self.failure_count} annotations. See logs for details.")
        log_since(self.before, f"Migrating all the {self.total_count} things")

    def migrate_annotation(self, annotation):
        before = time.time()
        try:
            if self.args.count_versions:
                versions = 0
                for tracing_id, layer_type in annotation["layers"].items():
                    update_collection = self.update_collection_for_layer_type(layer_type)
                    newest_version = self.get_newest_version(tracing_id, update_collection)
                    versions += newest_version
                if versions > 1:
                    logger.info(f"{versions} versions for {annotation['_id']}{self.get_progress()}")
            else:
                if self.args.verbose:
                    logger.info(f"Migrating annotation {annotation['_id']} (dry={self.args.dry}) ...")
                mapping_id_map = self.build_mapping_id_map(annotation)
                layer_version_mapping = self.migrate_updates(annotation, mapping_id_map)
                materialized_versions = self.migrate_materialized_layers(annotation, layer_version_mapping, mapping_id_map)
                logger.info(f"saved materialized versions {materialized_versions}")
                if len(materialized_versions) == 0:
                    raise ValueError(f"Zero materialized versions present in source FossilDB for annotation {annotation['_id']}.")
                self.create_and_save_annotation_proto(annotation, materialized_versions)
                if time.time() - before > 1 or self.args.verbose:
                    log_since(before, f"Migrating annotation {annotation['_id']} ({len(materialized_versions)} materialized versions)", self.get_progress())
        except Exception:
            logger.exception(f"Exception while migrating annotation {annotation['_id']}:")
            with self.failure_count_lock:
                self.failure_count += 1
        finally:
            with self.done_count_lock:
                self.done_count += 1

    def build_mapping_id_map(self, annotation) -> MappingIdMap:
        mapping_id_map = {}
        for tracing_id, layer_type in annotation["layers"].items():
            if layer_type == "Volume":
                editable_mapping_id = self.get_editable_mapping_id(tracing_id, layer_type)
                if editable_mapping_id is not None:
                    mapping_id_map[tracing_id] = editable_mapping_id
        return mapping_id_map

    def fetch_updates(self, tracing_or_mapping_id: str, layer_type: str, collection: str, json_encoder, json_decoder) -> List[Tuple[int, int, bytes]]:
        batch_size = 1000
        newest_version = self.get_newest_version(tracing_or_mapping_id, collection)
        updates_for_layer = []
        next_version = newest_version
        for batch_start, batch_end in reversed(list(batch_range(newest_version, batch_size))):
            if batch_start > next_version:
                continue
            update_groups = self.get_update_batch(tracing_or_mapping_id, collection, batch_start, batch_end)
            for version, update_group in reversed(update_groups):
                if version > next_version:
                    continue
                update_group, timestamp, revert_source_version = self.process_update_group(tracing_or_mapping_id, layer_type, update_group, json_encoder, json_decoder)
                if revert_source_version is not None:
                    next_version = revert_source_version
                else:
                    next_version -= 1
                if revert_source_version is None:  # skip the revert itself too, since we’re ironing them out
                    updates_for_layer.append((timestamp, version, update_group))
        updates_for_layer.reverse()
        return updates_for_layer

    def migrate_updates(self, annotation, mapping_id_map: MappingIdMap) -> LayerVersionMapping:
        all_update_groups = []
        json_encoder = msgspec.json.Encoder()
        json_decoder = msgspec.json.Decoder()
        layers = list(annotation["layers"].items())
        for tracing_id, layer_type in layers:
            collection = self.update_collection_for_layer_type(layer_type)
            all_update_groups.append(self.fetch_updates(tracing_id, layer_type, collection, json_encoder=json_encoder, json_decoder=json_decoder))
            if tracing_id in mapping_id_map:
                editable_mapping_id = mapping_id_map[tracing_id]
                all_update_groups.append(self.fetch_updates(editable_mapping_id, "editableMapping", "editableMappingUpdates", json_encoder=json_encoder, json_decoder=json_decoder))

        unified_version = 0
        version_mapping = {}
        for tracing_id, _ in layers:
            version_mapping[tracing_id] = {0: 0} # We always want to keep the initial version 0 of all layers, even if there are no updates at all.

        queue = []
        for i, update_groups_for_layer in enumerate(all_update_groups):
            if update_groups_for_layer:
                # The priority queue sorts tupley lexicographically, so timestamp is the main sorting key here
                heapq.heappush(queue, (update_groups_for_layer[0], i, 0))
        while queue:
            value, layer_index, element_index = heapq.heappop(queue)
            timestamp, version, update_group = value
            tracing_id = layers[layer_index][0]

            unified_version += 1
            version_mapping[tracing_id][version] = unified_version
            logger.info(f"saving update v{unified_version}")
            self.save_update_group(annotation['_id'], unified_version, update_group)

            if element_index + 1 < len(all_update_groups[layer_index]):
                next_element = all_update_groups[layer_index][element_index + 1]
                heapq.heappush(queue, (next_element, layer_index, element_index + 1))

        return version_mapping

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

    def process_update_group(self, tracing_id: str, layer_type: str, update_group_raw: bytes, json_encoder, json_decoder) -> Tuple[bytes, int, Optional[int]]:
        update_group_parsed = json_decoder.decode(update_group_raw)

        revert_source_version = None
        action_timestamp = 0

        for update in update_group_parsed:
            name = update["name"]
            update_value = update["value"]

            # renamings
            if name == "updateTracing":
                update["name"] = f"update{layer_type}Tracing"
            elif name == "updateUserBoundingBoxes":
                update["name"] = f"updateUserBoundingBoxesIn{layer_type}Tracing"
            elif name == "updateUserBoundingBoxVisibility":
                update["name"] = f"updateUserBoundingBoxVisibilityIn{layer_type}Tracing"

            name = update["name"]

            # add actionTracingId
            if not name == "updateTdCamera":
                update["value"]["actionTracingId"] = tracing_id

            # identify compact update actions, and mark them
            if (name == "updateBucket" and "position" not in update_value) \
                or (name == "updateVolumeTracing" and "activeSegmentId" not in update_value) \
                or (name == "updateUserBoundingBoxesInVolumeTracing" and "boundingBoxes" not in update_value) \
                or (name == "updateUserBoundingBoxVisibilityInVolumeTracing" and "boundingBoxId" not in update_value) \
                or (name == "deleteSegmentData" and "id" not in update_value) \
                or (name == "createSegment" and "name" not in update_value) \
                or (name == "updateSegment" and "name" not in update_value) \
                or (name == "updateMappingName" and "mappingName" not in update_value):
                update["isCompacted"] = True

            if name == "revertToVersion":
                # Assumption: revertToVersion actions are the only ones in their group.
                revert_source_version = update_value["sourceVersion"]

            if "actionTimestamp" in update_value is not None:
                action_timestamp = update_value["actionTimestamp"]

        return json_encoder.encode(update_group_parsed), action_timestamp, revert_source_version

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

    def migrate_materialized_layers(self, annotation: RealDictRow, layer_version_mapping: LayerVersionMapping, mapping_id_map: MappingIdMap) -> Set[int]:
        #newest_to_materialize = self.get_newest_to_materialize(annotation, layer_version_mapping, mapping_id_map)

        materialized_versions = set()
        for tracing_id, tracing_type in annotation["layers"].items():
            materialized_versions_of_layer = \
                self.migrate_materialized_layer(tracing_id, tracing_type, layer_version_mapping, mapping_id_map)
            materialized_versions.update(materialized_versions_of_layer)
        return materialized_versions

    def get_newest_to_materialize(self, annotation, layer_version_mapping: LayerVersionMapping, mapping_id_map: MappingIdMap) -> int:
        newest_to_materialize = 0
        for tracing_id, tracing_type in annotation["layers"].items():
            if tracing_type == "Skeleton":
                collection = "skeletons"
            else:
                collection = "volumes"
            # TODO what if the newest materialized is dropped because of a revert?
            newest_materialized = layer_version_mapping[tracing_id][self.get_newest_version(tracing_id, collection)]
            newest_to_materialize = min(newest_to_materialize, newest_materialized)
        for editable_mapping_id in mapping_id_map.values():
            newest_materialized = layer_version_mapping[editable_mapping_id][self.get_newest_version(editable_mapping_id, "editableMappingsInfo")]
            newest_to_materialize = min(newest_to_materialize, newest_materialized)
        return newest_to_materialize

    def migrate_materialized_layer(self, tracing_id: str, layer_type: str, layer_version_mapping: LayerVersionMapping, mapping_id_map: MappingIdMap) -> List[int]:
        if layer_type == "Skeleton":
            return self.migrate_skeleton_proto(tracing_id, layer_version_mapping)
        if layer_type == "Volume":
            materialized_volume_versions = self.migrate_volume_proto(tracing_id, layer_version_mapping, mapping_id_map)
            self.migrate_volume_buckets(tracing_id, layer_version_mapping)
            self.migrate_segment_index(tracing_id, layer_version_mapping)
            materialized_mapping_versions = self.migrate_editable_mapping(tracing_id, layer_version_mapping, mapping_id_map)
            return materialized_volume_versions + materialized_mapping_versions

    def migrate_skeleton_proto(self, tracing_id: str, layer_version_mapping: LayerVersionMapping) -> List[int]:
        collection = "skeletons"
        materialized_versions_unified = []
        materialized_versions = self.list_versions(collection, tracing_id)
        for materialized_version in materialized_versions:
            if materialized_version not in layer_version_mapping[tracing_id]:
                continue
            new_version = layer_version_mapping[tracing_id][materialized_version]
            value_bytes = self.get_bytes(collection, tracing_id, materialized_version)
            if materialized_version != new_version:
                skeleton = Skeleton.SkeletonTracing()
                skeleton.ParseFromString(value_bytes)
                skeleton.version = new_version
                value_bytes = skeleton.SerializeToString()
            materialized_versions_unified.append(new_version)
            logger.info(f"saving materialized skeleton {new_version}")
            self.save_bytes(collection, tracing_id, new_version, value_bytes)
        return materialized_versions_unified

    def migrate_volume_proto(self, tracing_id: str, layer_version_mapping: LayerVersionMapping, mapping_id_map: MappingIdMap):
        collection = "volumes"
        materialized_versions_unified = []
        materialized_versions = self.list_versions(collection, tracing_id)
        for materialized_version in materialized_versions:
            if materialized_version not in layer_version_mapping[tracing_id]:
                continue
            new_version = layer_version_mapping[tracing_id][materialized_version]
            value_bytes = self.get_bytes(collection, tracing_id, materialized_version)
            if materialized_version != new_version or tracing_id in mapping_id_map:
                volume = Volume.VolumeTracing()
                volume.ParseFromString(value_bytes)
                volume.version = new_version
                if tracing_id in mapping_id_map:
                    volume.mappingName = tracing_id
                value_bytes = volume.SerializeToString()
            materialized_versions_unified.append(new_version)
            logger.info(f"saving materialized volume {new_version}")
            self.save_bytes(collection, tracing_id, new_version, value_bytes)
        return materialized_versions_unified

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
        current_start_after_key = tracing_id + "."  # . is lexicographically before /
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
                            if version not in layer_version_mapping[tracing_id]:
                                continue
                            new_version = layer_version_mapping[tracing_id][version]
                            self.save_bytes(collection, new_key, new_version, value)
                    current_start_after_key = key
                else:
                    # We iterated past the elements of the current tracing
                    return

    def migrate_segment_index(self, tracing_id, layer_version_mapping):
        self.migrate_all_versions_and_keys_with_prefix("volumeSegmentIndex", tracing_id, layer_version_mapping, transform_key=None)

    def migrate_editable_mapping(self, tracing_id: str, layer_version_mapping: LayerVersionMapping, mapping_id_map: MappingIdMap) -> List[int]:
        if tracing_id not in mapping_id_map:
            return []
        mapping_id = mapping_id_map[tracing_id]
        materialized_versions = self.migrate_editable_mapping_info(tracing_id, mapping_id, layer_version_mapping)
        self.migrate_editable_mapping_agglomerate_to_graph(tracing_id, mapping_id, layer_version_mapping)
        self.migrate_editable_mapping_segment_to_agglomerate(tracing_id, mapping_id, layer_version_mapping)
        return materialized_versions

    def migrate_editable_mapping_info(self, tracing_id: str, mapping_id: str, layer_version_mapping: LayerVersionMapping) -> List[int]:
        collection = "editableMappingsInfo"
        materialized_versions = self.list_versions(collection, mapping_id)
        materialized_versions_unified = []
        for materialized_version in materialized_versions:
            value_bytes = self.get_bytes(collection, mapping_id, materialized_version)
            if materialized_version not in layer_version_mapping[tracing_id]:
                continue
            new_version = layer_version_mapping[mapping_id][materialized_version]
            materialized_versions_unified.append(new_version)
            self.save_bytes(collection, tracing_id, new_version, value_bytes)
        return materialized_versions_unified

    def migrate_editable_mapping_agglomerate_to_graph(self, tracing_id: str, mapping_id: str, layer_version_mapping: LayerVersionMapping):
        self.migrate_all_versions_and_keys_with_prefix(
            "editableMappingsAgglomerateToGraph",
            mapping_id,
            layer_version_mapping,
            transform_key=partial(self.replace_before_first_slash, tracing_id)
        )

    def migrate_editable_mapping_segment_to_agglomerate(self, tracing_id: str, mapping_id: str, layer_version_mapping: LayerVersionMapping):
        self.migrate_all_versions_and_keys_with_prefix(
            "editableMappingsSegmentToAgglomerate",
            mapping_id,
            layer_version_mapping,
            transform_key=partial(self.replace_before_first_slash, tracing_id)
        )

    def create_and_save_annotation_proto(self, annotation, materialized_versions: Set[int]):
        for version in materialized_versions:
            annotationProto = AnnotationProto.AnnotationProto()
            annotationProto.description = annotation["description"] or ""
            annotationProto.version = version
            annotationProto.earliestAccessibleVersion = 0  # TODO different for merged editable mappings
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

    def read_annotation_list(self):
        before = time.time()
        start_time = datetime.datetime.now()
        previous_start_label = ""
        previous_start_query = ""
        if self.args.previous_start is not None:
            previous_start_label = f" and after previous start time {self.args.previous_start}"
            previous_start_query = f" AND modified > '{self.args.previous_start}'"
        logger.info(f"Looking only for annotations last modified before start time {start_time}{previous_start_label}.")
        logger.info("Determining annotation count from postgres...")
        page_size = 10000
        connection = connect_to_postgres(self.args.postgres)
        cursor = connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cursor.execute(f"SELECT COUNT(*) FROM webknossos.annotations WHERE modified < '{start_time}'{previous_start_query}")
        annotation_count = cursor.fetchone()['count']
        logger.info(f"Loading infos of {annotation_count} annotations from postgres ...")
        annotations = []
        page_count = math.ceil(annotation_count / page_size)
        for page_num in track(range(page_count), total=page_count, description=f"Loading annotation infos ..."):
            query = f"""
                WITH annotations AS (
                    SELECT _id, name, description, created, modified FROM webknossos.annotations
                    WHERE modified < '{start_time}'
                    {previous_start_query}
                    ORDER BY MD5(_id)
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
        if annotation_count != len(annotations):
            logger.info(f"Note that only {len(annotations)} of the {annotation_count} annotations have layers. Skipping zero-layer annotations.")
        log_since(before, "Loading annotation infos from postgres")
        return annotations

    def remove_morton_index(self, bucket_key: str) -> str:
        first_slash_index = bucket_key.index('/')
        second_slash_index = bucket_key.index('/', first_slash_index + 1)
        first_bracket_index = bucket_key.index('[')
        return bucket_key[:second_slash_index + 1] + bucket_key[first_bracket_index:]

    def replace_before_first_slash(self, replacement_prefix: str, key) -> str:
        slash_pos = key.find('/')
        return replacement_prefix + key[slash_pos:]

    def get_progress(self) -> str:
        with self.done_count_lock:
            done_count = self.done_count
        percentage = 100.0 * done_count / self.total_count
        duration = time.time() - self.before
        if done_count > 0:
            etr = duration / done_count * (self.total_count - done_count)
            etr_formatted = f". ETR {humanize_time_diff(etr)})"
        else:
            etr_formatted = ")"
        return f". ({done_count}/{self.total_count} = {percentage:.1f}% done{etr_formatted}"