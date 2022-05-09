package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import java.util.UUID

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.tracingstore.tracings.{
  KeyValueStoreImplicits,
  TracingDataStore,
  VersionedKeyValuePair
}

import scala.concurrent.ExecutionContext

class EditableMappingService @Inject()(
    val tracingDataStore: TracingDataStore
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
}
