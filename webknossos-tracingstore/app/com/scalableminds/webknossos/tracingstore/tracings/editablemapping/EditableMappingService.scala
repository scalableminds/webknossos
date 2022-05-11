package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import java.util.UUID

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Edge, Tree}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClass
import com.scalableminds.webknossos.datastore.helpers.{NodeDefaults, ProtoGeometryImplicits, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.models.{UnsignedInteger, UnsignedIntegerArray, WebKnossosDataRequest}
import com.scalableminds.webknossos.tracingstore.TSRemoteDatastoreClient
import com.scalableminds.webknossos.tracingstore.tracings.{
  KeyValueStoreImplicits,
  TracingDataStore,
  VersionedKeyValuePair
}
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Empty, Full}

import scala.concurrent.ExecutionContext

class EditableMappingService @Inject()(
    val tracingDataStore: TracingDataStore,
    remoteDatastoreClient: TSRemoteDatastoreClient
)(implicit ec: ExecutionContext)
    extends KeyValueStoreImplicits
    with FoxImplicits
    with ProtoGeometryImplicits {

  private def generateId: String = UUID.randomUUID.toString

  def currentVersion(editableMappingId: String): Fox[Long] =
    tracingDataStore.editableMappings.getVersion(editableMappingId, mayBeEmpty = Some(true), emptyFallback = Some(0L))

  def create(baseMappingName: String): Fox[String] = {
    val newId = generateId
    val newEditableMapping = EditableMapping(
      baseMappingName,
      Map(),
      Map(),
      Map(),
      Map(),
      Map()
    )
    for {
      _ <- tracingDataStore.editableMappings.put(newId, 0L, newEditableMapping.toBytes)
    } yield newId
  }

  def exists(editableMappingId: String): Fox[Boolean] =
    for {
      versionOrMinusOne: Long <- tracingDataStore.editableMappings.getVersion(editableMappingId,
                                                                              mayBeEmpty = Some(true),
                                                                              version = Some(0L),
                                                                              emptyFallback = Some(-1L))
    } yield versionOrMinusOne >= 0

  def get(editableMappingId: String,
          remoteFallbackLayer: RemoteFallbackLayer,
          userToken: Option[String],
          version: Option[Long] = None): Fox[EditableMapping] =
    for {
      closestMaterializedVersion: VersionedKeyValuePair[Array[Byte]] <- tracingDataStore.editableMappings
        .get(editableMappingId, version)
      materialized <- applyPendingUpdates(
        editableMappingId,
        EditableMapping.fromBytes(closestMaterializedVersion.value),
        remoteFallbackLayer,
        closestMaterializedVersion.version,
        version,
        userToken
      )
    } yield materialized

  private def findDesiredOrNewestPossibleVersion(existingMaterializedVersion: Long,
                                                 editableMappingId: String,
                                                 desiredVersion: Option[Long]): Fox[Long] =
    /*
     * Determines the newest saved version from the updates column.
     * if there are no updates at all, assume mapping is brand new,
     * hence the emptyFallbck tracing.version)
     */
    for {
      newestUpdateVersion <- tracingDataStore.editableMappingUpdates.getVersion(editableMappingId,
                                                                                mayBeEmpty = Some(true),
                                                                                emptyFallback =
                                                                                  Some(existingMaterializedVersion))
    } yield {
      desiredVersion match {
        case None              => newestUpdateVersion
        case Some(desiredSome) => math.min(desiredSome, newestUpdateVersion)
      }
    }

  private def applyPendingUpdates(editableMappingId: String,
                                  existingEditableMapping: EditableMapping,
                                  remoteFallbackLayer: RemoteFallbackLayer,
                                  existingVersion: Long,
                                  requestedVersion: Option[Long],
                                  userToken: Option[String]): Fox[EditableMapping] =
    for {
      desiredVersion <- findDesiredOrNewestPossibleVersion(existingVersion, editableMappingId, requestedVersion)
      pendingUpdates <- findPendingUpdates(editableMappingId, existingVersion, desiredVersion)
      appliedEditableMapping <- applyUpdates(existingEditableMapping, pendingUpdates, remoteFallbackLayer, userToken)
    } yield appliedEditableMapping

  private def applyUpdates(existingEditableMapping: EditableMapping,
                           updates: List[EditableMappingUpdateAction],
                           remoteFallbackLayer: RemoteFallbackLayer,
                           userToken: Option[String]): Fox[EditableMapping] = {
    def updateIter(mappingFox: Fox[EditableMapping],
                   remainingUpdates: List[EditableMappingUpdateAction]): Fox[EditableMapping] =
      mappingFox.futureBox.flatMap {
        case Empty => Fox.empty
        case Full(mapping) =>
          remainingUpdates match {
            case List() => Fox.successful(mapping)
            case head :: tail =>
              updateIter(applyOneUpdate(mapping, head, remoteFallbackLayer, userToken), tail)
          }
        case _ => mappingFox
      }

    updateIter(Some(existingEditableMapping), updates)
  }

  private def applyOneUpdate(mapping: EditableMapping,
                             update: EditableMappingUpdateAction,
                             remoteFallbackLayer: RemoteFallbackLayer,
                             userToken: Option[String]): Fox[EditableMapping] =
    update match {
      case splitAction: SplitAgglomerateUpdateAction =>
        applySplitAction(mapping, splitAction, remoteFallbackLayer, userToken)
      case mergeAction: MergeAgglomerateUpdateAction =>
        applyMergeAction(mapping, mergeAction, remoteFallbackLayer, userToken)
    }

  private def applySplitAction(mapping: EditableMapping,
                               update: SplitAgglomerateUpdateAction,
                               remoteFallbackLayer: RemoteFallbackLayer,
                               userToken: Option[String]): Fox[EditableMapping] = ???

  private def applyMergeAction(mapping: EditableMapping,
                               update: MergeAgglomerateUpdateAction,
                               remoteFallbackLayer: RemoteFallbackLayer,
                               userToken: Option[String]): Fox[EditableMapping] =
    for {
      segmentId2 <- findSegmentIdAtPosition(remoteFallbackLayer, update.segmentPosition2, userToken)
      // TODO
    } yield mapping

  private def findSegmentIdAtPosition(remoteFallbackLayer: RemoteFallbackLayer,
                                      pos: Vec3Int,
                                      userToken: Option[String]): Fox[Long] =
    for {
      voxelAsBytes: Array[Byte] <- remoteDatastoreClient.getVoxelAtPosition(userToken,
                                                                            remoteFallbackLayer,
                                                                            pos,
                                                                            mag = Vec3Int(1, 1, 1))
      voxelAsLongArray: Array[Long] <- bytesToLongs(voxelAsBytes, remoteFallbackLayer.elementClass)
      _ <- Fox.bool2Fox(voxelAsLongArray.length == 1) ?~> s"Expected one, got ${voxelAsLongArray.length} segment id values for voxel."
      voxelAsLong <- voxelAsLongArray.headOption
    } yield voxelAsLong

  private def findPendingUpdates(editableMappingId: String, existingVersion: Long, desiredVersion: Long)(
      implicit ec: ExecutionContext): Fox[List[EditableMappingUpdateAction]] =
    if (desiredVersion == existingVersion) Fox.successful(List())
    else {
      tracingDataStore.editableMappingUpdates.getMultipleVersions(
        editableMappingId,
        Some(desiredVersion),
        Some(existingVersion + 1)
      )(fromJson[EditableMappingUpdateAction])
    }

  def update(editableMappingId: String, updateAction: EditableMappingUpdateAction, version: Long): Fox[Unit] =
    for {
      _ <- tracingDataStore.editableMappingUpdates.put(editableMappingId, version, updateAction)
    } yield ()

  def volumeData(tracing: VolumeTracing,
                 dataRequests: DataRequestCollection,
                 userToken: Option[String]): Fox[(Array[Byte], List[Int])] =
    for {
      editableMappingId <- tracing.mappingName.toFox
      remoteFallbackLayer <- remoteFallbackLayer(tracing)
      editableMapping <- get(editableMappingId, remoteFallbackLayer, userToken)
      (unmappedData, indices) <- getUnmappedDataFromDatastore(remoteFallbackLayer, dataRequests)
      segmentIds <- collectSegmentIds(unmappedData, tracing.elementClass)
      relevantMapping <- generateCombinedMappingSubset(segmentIds, editableMapping, remoteFallbackLayer)
      mappedData <- mapData(unmappedData, relevantMapping, tracing.elementClass)
    } yield (mappedData, indices)

  private def generateCombinedMappingSubset(segmentIds: Set[Long],
                                            editableMapping: EditableMapping,
                                            remoteFallbackLayer: RemoteFallbackLayer): Fox[Map[Long, Long]] = {
    val segmentIdsInEditableMapping: Set[Long] = segmentIds.intersect(editableMapping.segmentToAgglomerate.keySet)
    val segmentIdsInBaseMapping: Set[Long] = segmentIds.diff(segmentIdsInEditableMapping)
    val editableMappingSubset =
      editableMapping.segmentToAgglomerate.filterKeys(key => segmentIdsInEditableMapping.contains(key))
    for {
      baseMappingSubset <- getBaseSegmentToAgglomeate(editableMapping.baseMappingName,
                                                      segmentIdsInBaseMapping,
                                                      remoteFallbackLayer)
    } yield editableMappingSubset ++ baseMappingSubset
  }

  def getAgglomerateSkeletonWithFallback(editableMappingId: String,
                                         remoteFallbackLayer: RemoteFallbackLayer,
                                         agglomerateId: Long,
                                         userToken: Option[String]): Fox[Array[Byte]] =
    for {
      editableMapping <- get(editableMappingId, remoteFallbackLayer, userToken)
      agglomerateIdIsPresent = editableMapping.agglomerateToSegments.contains(agglomerateId)
      skeletonBytes <- if (agglomerateIdIsPresent)
        getAgglomerateSkeleton(editableMappingId, editableMapping, remoteFallbackLayer, agglomerateId)
      else
        remoteDatastoreClient.getAgglomerateSkeleton(userToken,
                                                     remoteFallbackLayer,
                                                     editableMapping.baseMappingName,
                                                     agglomerateId)
    } yield skeletonBytes

  private def getAgglomerateSkeleton(editableMappingId: String,
                                     editableMapping: EditableMapping,
                                     remoteFallbackLayer: RemoteFallbackLayer,
                                     agglomerateId: Long): Fox[Array[Byte]] =
    for {
      positions <- editableMapping.agglomerateToPositions.get(agglomerateId)
      nodes = positions.zipWithIndex.map {
        case (pos, idx) =>
          NodeDefaults.createInstance.copy(
            id = idx,
            position = pos
          )
      }
      edges <- editableMapping.agglomerateToEdges.get(agglomerateId)
      skeletonEdges = edges.map { e =>
        Edge(source = e._1.toInt, target = e._2.toInt)
      }

      trees = Seq(
        Tree(
          treeId = agglomerateId.toInt,
          createdTimestamp = System.currentTimeMillis(),
          nodes = nodes,
          edges = skeletonEdges,
          name = s"agglomerate $agglomerateId ($editableMappingId)"
        ))

      skeleton = SkeletonTracingDefaults.createInstance.copy(
        dataSetName = remoteFallbackLayer.dataSetName,
        trees = trees,
        organizationName = Some(remoteFallbackLayer.organizationName)
      )
    } yield skeleton.toByteArray

  private def getBaseSegmentToAgglomeate(mappingName: String,
                                         segmentIds: Set[Long],
                                         remoteFallbackLayer: RemoteFallbackLayer): Fox[Map[Long, Long]] = {
    val segmentIdsOrdered = segmentIds.toList
    for {
      agglomerateIdsOrdered <- remoteDatastoreClient.getAgglomerateIdsForSegmentIds(remoteFallbackLayer,
                                                                                    mappingName,
                                                                                    segmentIdsOrdered)
    } yield segmentIdsOrdered.zip(agglomerateIdsOrdered).toMap
  }

  private def getUnmappedDataFromDatastore(remoteFallbackLayer: RemoteFallbackLayer,
                                           dataRequests: DataRequestCollection): Fox[(Array[Byte], List[Int])] =
    for {
      dataRequestsTyped <- Fox.serialCombined(dataRequests) {
        case r: WebKnossosDataRequest => Fox.successful(r)
        case _                        => Fox.failure("Editable Mappings currently only work for webKnossos data requests")
      }
      (data, indices) <- remoteDatastoreClient.getData(remoteFallbackLayer, dataRequestsTyped)
    } yield (data, indices)

  private def collectSegmentIds(data: Array[Byte], elementClass: ElementClass): Fox[Set[Long]] =
    for {
      dataAsLongs <- bytesToLongs(data, elementClass)
    } yield dataAsLongs.toSet

  def remoteFallbackLayer(tracing: VolumeTracing): Fox[RemoteFallbackLayer] =
    for {
      layerName <- tracing.fallbackLayer.toFox ?~> "This feature is only defined on volume annotations with fallback segmentation layer."
      organizationName <- tracing.organizationName.toFox ?~> "This feature is only implemented for volume annotations with an explicit organization name tag, not for legacy volume annotations."
    } yield RemoteFallbackLayer(organizationName, tracing.dataSetName, layerName, tracing.elementClass)

  private def mapData(unmappedData: Array[Byte],
                      relevantMapping: Map[Long, Long],
                      elementClass: ElementClass): Fox[Array[Byte]] =
    for {
      unmappedDataLongs <- bytesToLongs(unmappedData, elementClass)
      mappedDataLongs = unmappedDataLongs.map(relevantMapping)
      bytes <- longsToBytes(mappedDataLongs, elementClass)
    } yield bytes

  private def bytesToLongs(bytes: Array[Byte], elementClass: ElementClass): Fox[Array[Long]] =
    for {
      _ <- bool2Fox(!elementClass.isuint64)
      unsignedIntArray <- tryo(UnsignedIntegerArray.fromByteArray(bytes, elementClass)).toFox
    } yield unsignedIntArray.map(_.toUnsignedLong)

  private def longsToBytes(longs: Array[Long], elementClass: ElementClass): Fox[Array[Byte]] =
    for {
      _ <- bool2Fox(!elementClass.isuint64)
      unsignedIntArray: Array[UnsignedInteger] = longs.map(UnsignedInteger.fromLongWithElementClass(_, elementClass))
      bytes = UnsignedIntegerArray.toByteArray(unsignedIntArray, elementClass)
    } yield bytes

}
