package com.scalableminds.braingames.datastore.tracings.skeleton

import java.util.UUID

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.binary.store.kvstore.VersionedKeyValuePair
import com.scalableminds.braingames.datastore.tracings.TracingDataStore
import com.scalableminds.braingames.datastore.tracings.skeleton.elements.SkeletonTracing
import com.scalableminds.util.geometry.Scale
import net.liftweb.common.{Box, Full}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.{JsValue, Json}

/**
  * Created by f on 28.06.17.
  */
class SkeletonTracingService @Inject()(
                                        val tracingDataStore: TracingDataStore
                                      ) {

  private def buildTracingKey(id: String) = s"/tracings/skeletons/$id"
  private def buildUpdatesKey(id: String) = s"/updateActions/skeletons/$id"
  private def createNewId(): String = UUID.randomUUID.toString

  def find(tracingId: String, version: Option[Long] = None): Box[SkeletonTracing] =
    tracingDataStore.getJson[SkeletonTracing](buildTracingKey(tracingId), version).map(_.value)

  def findVersioned(tracingId: String, version: Option[Long] = None): Box[VersionedKeyValuePair[SkeletonTracing]] =
    tracingDataStore.getJson[SkeletonTracing](buildTracingKey(tracingId), version)

  def create(datSetName: String): SkeletonTracing = {
    val id = createNewId()
    val tracing = SkeletonTracing(
      id = id,
      name = s"tracing_$id",
      dataSetName = datSetName,
      trees = List(),
      timestamp = System.currentTimeMillis(),
      activeNodeId = None,
      scale = new Scale(1,1,1),
      editPosition = None,
      editRotation = None,
      zoomLevel = None)
    tracingDataStore.putJson(buildTracingKey(tracing.id), 1, tracing)
    tracing
  }

  def createFromNML(name: String, nml: String): Box[SkeletonTracing] = {
    for {
      tracing <- NMLParser.parse(createNewId(), name, nml.trim())
    } yield {
      tracingDataStore.putJson(buildTracingKey(tracing.id), 1, tracing)
      tracing
    }
  }

  def saveUpdates(tracing: SkeletonTracing, updates: List[SkeletonUpdateAction], newVersion: Long): Box[Unit] = {
    tracingDataStore.putJson(buildUpdatesKey(tracing.id), newVersion, updates)
  }

  def update(tracing: SkeletonTracing, updates: List[SkeletonUpdateAction], newVersion: Long): SkeletonTracing  = {
    def updateIter(tracing: SkeletonTracing, remainingUpdates: List[SkeletonUpdateAction]): SkeletonTracing = remainingUpdates match {
      case List() => tracing
      case update :: tail => updateIter(update.applyOn(tracing), tail)
    }
    val updated = updateIter(tracing, updates)
    tracingDataStore.putJson(buildTracingKey(updated.id), newVersion, updated)
    updated
  }

  def downloadJson(tracing: SkeletonTracing): Box[JsValue] = {
    Some(Json.toJson(tracing))
  }

  private def findUpdates(tracingId: String, version: Long): Box[List[SkeletonUpdateAction]] = {
    tracingDataStore.getJson[List[SkeletonUpdateAction]](buildUpdatesKey(tracingId), Some(version)).map(_.value)
  }

  private def findPendingUpdates(tracingId: String, existingVersion: Long, desiredVersion: Long): List[SkeletonUpdateAction] = {
    (existingVersion+1 to desiredVersion).flatMap(findUpdates(tracingId, _)).toList.flatten
  }

  def applyPendingUpdates(tracingVersioned: VersionedKeyValuePair[SkeletonTracing], desiredVersion: Long): Box[SkeletonTracing] = {
    val tracing = tracingVersioned.value
    val existingVersion = tracingVersioned.version
    val pendingUpdates = findPendingUpdates(tracing.id, existingVersion, desiredVersion)
    val updatedTracing = update(tracing, pendingUpdates, desiredVersion)
    Some(updatedTracing)
  }

  def downloadNML(tracing: SkeletonTracing, dataSourceRepository: DataSourceRepository): Option[Enumerator[Array[Byte]]] = {
    for {
      dataSource <- dataSourceRepository.findUsableByName(tracing.dataSetName)
    } yield {
      Enumerator.outputStream { os =>
        NMLWriter.toNML(tracing, os, dataSource.scale).map(_ => os.close())
      }
    }
  }

  def duplicate(tracing: SkeletonTracing): Box[SkeletonTracing] = ???

}
