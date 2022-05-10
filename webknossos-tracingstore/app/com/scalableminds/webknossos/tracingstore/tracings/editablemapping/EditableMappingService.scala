package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import java.util.UUID

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.option2Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClass
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.tracingstore.TSRemoteDatastoreClient
import com.scalableminds.webknossos.tracingstore.tracings.{
  KeyValueStoreImplicits,
  TracingDataStore,
  VersionedKeyValuePair
}

import scala.concurrent.ExecutionContext

class EditableMappingService @Inject()(
    val tracingDataStore: TracingDataStore,
    remoteDatastoreClient: TSRemoteDatastoreClient
)(implicit ec: ExecutionContext)
    extends KeyValueStoreImplicits {

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

  def get(editableMappingId: String, version: Option[Long] = None): Fox[EditableMapping] =
    for {
      closestMaterializedVersion: VersionedKeyValuePair[Array[Byte]] <- tracingDataStore.editableMappings
        .get(editableMappingId, version)
      materialized <- applyPendingUpdates(editableMappingId,
                                          EditableMapping.fromBytes(closestMaterializedVersion.value),
                                          closestMaterializedVersion.version,
                                          version)
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
                                  existingVersion: Long,
                                  requestedVersion: Option[Long]): Fox[EditableMapping] =
    for {
      desiredVersion <- findDesiredOrNewestPossibleVersion(existingVersion, editableMappingId, requestedVersion)
      pendingUpdates <- findPendingUpdates(editableMappingId, existingVersion, desiredVersion)
      appliedEditableMapping <- applyUpdates(existingEditableMapping, existingVersion, desiredVersion, pendingUpdates)
    } yield appliedEditableMapping

  private def applyUpdates(existingEditableMapping: EditableMapping,
                           existingVersion: Long,
                           desiredVersion: Long,
                           pendingUpdates: List[EditableMappingUpdateAction]): Fox[EditableMapping] = ???

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

  def volumeData(tracingId: String,
                 tracing: VolumeTracing,
                 dataRequests: DataRequestCollection): Fox[(Array[Byte], List[Int])] =
    for {
      editableMappingId <- tracing.mappingName.toFox
      editableMapping <- get(editableMappingId)
      remoteFallbackLayer <- remoteFallbackLayer(tracing)
      (unmappedData, indices) <- getUnmappedDataFromDatastore(remoteFallbackLayer, dataRequests)
      segmentIds = collectSegmentIds(unmappedData, indices, tracing.elementClass)
      relevantMapping <- generateCombinedMappingSubset(segmentIds, editableMapping, remoteFallbackLayer)
      mappedData <- mapData(unmappedData, indices, relevantMapping)
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

  private def getBaseSegmentToAgglomeate(mappingName: String,
                                         segmentIds: Set[Long],
                                         remoteFallbackLayer: RemoteFallbackLayer): Fox[Map[Long, Long]] = ???

  private def getUnmappedDataFromDatastore(remoteFallbackLayer: RemoteFallbackLayer,
                                           dataRequests: DataRequestCollection): Fox[(Array[Byte], List[Int])] =
    for {
      (data, indices) <- remoteDatastoreClient.getData(remoteFallbackLayer, dataRequests)
    } yield (data, indices)

  private def collectSegmentIds(data: Array[Byte], indices: List[Int], elementClass: ElementClass): Set[Long] = ???

  private def remoteFallbackLayer(tracing: VolumeTracing): Fox[RemoteFallbackLayer] =
    for {
      layerName <- tracing.fallbackLayer.toFox
      organizationName <- tracing.organizationName.toFox
    } yield RemoteFallbackLayer(organizationName, tracing.dataSetName, layerName)

  private def mapData(unmappedData: Array[Byte],
                      indices: List[Int],
                      relevantMapping: Map[Long, Long]): Fox[Array[Byte]] = ???
}

case class RemoteFallbackLayer(organizationName: String, dataSetName: String, layerName: String)
