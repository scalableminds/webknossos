package com.scalableminds.braingames.datastore.tracings.skeleton

import java.util.UUID

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.binary.storage.kvstore.VersionedKeyValuePair
import com.scalableminds.braingames.datastore.tracings.TracingDataStore
import com.scalableminds.braingames.datastore.tracings.skeleton.elements.SkeletonTracing
import com.scalableminds.util.geometry.Scale
import net.liftweb.common.Box
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.{JsValue, Json}

/**
  * Created by f on 28.06.17.
  */
class SkeletonTracingService @Inject()(
                                        tracingDataStore: TracingDataStore
                                      ) {

  private def createNewId(): String = UUID.randomUUID.toString

  def find(tracingId: String, version: Option[Long] = None): Box[SkeletonTracing] =
    tracingDataStore.skeletons.getJson[SkeletonTracing](tracingId, version).map(_.value)

  def findVersioned(tracingId: String, version: Option[Long] = None): Box[VersionedKeyValuePair[SkeletonTracing]] =
    tracingDataStore.skeletons.getJson[SkeletonTracing](tracingId, version)

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
    tracingDataStore.skeletons.putJson(tracing.id, 0, tracing)
    tracing
  }

  def createFromNML(name: String, nml: String): Box[SkeletonTracing] = {
    for {
      tracing <- NMLParser.parse(createNewId(), name, nml.trim())
    } yield {
      tracingDataStore.skeletons.putJson(tracing.id, 0, tracing)
      tracing
    }
  }

  def saveUpdates(tracing: SkeletonTracing, updates: List[SkeletonUpdateAction], newVersion: Long): Box[Unit] = {
    tracingDataStore.skeletons.putJson(tracing.id, newVersion, updates)
  }

  def downloadJson(tracing: SkeletonTracing): Box[JsValue] = {
    Some(Json.toJson(tracing))
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

  def applyPendingUpdates(tracingVersioned: VersionedKeyValuePair[SkeletonTracing], desiredVersion: Long): Box[SkeletonTracing] = {
    val tracing = tracingVersioned.value
    val existingVersion = tracingVersioned.version
    val pendingUpdates = findPendingUpdates(tracing.id, existingVersion, desiredVersion)
    val updatedTracing = update(tracing, pendingUpdates, desiredVersion)
    Some(updatedTracing)
  }

  private def findPendingUpdates(tracingId: String, existingVersion: Long, desiredVersion: Long): List[SkeletonUpdateAction] = {
    def toListIter(versionIterator: Iterator[VersionedKeyValuePair[List[SkeletonUpdateAction]]],
                   acc: List[List[SkeletonUpdateAction]]): List[List[SkeletonUpdateAction]] = {
      if (!versionIterator.hasNext) acc
      else {
        val item = versionIterator.next()
        if (item.version <= existingVersion) acc
        else toListIter(versionIterator, item.value :: acc)
      }
    }

    val versionIterator = tracingDataStore.skeletonUpdates.scanVersionsJson[List[SkeletonUpdateAction]](tracingId, Some(desiredVersion))
    toListIter(versionIterator, List()).flatten
  }

  private def update(tracing: SkeletonTracing, updates: List[SkeletonUpdateAction], newVersion: Long): SkeletonTracing  = {
    def updateIter(tracing: SkeletonTracing, remainingUpdates: List[SkeletonUpdateAction]): SkeletonTracing = remainingUpdates match {
      case List() => tracing
      case update :: tail => updateIter(update.applyOn(tracing), tail)
    }
    val updated = updateIter(tracing, updates)
    tracingDataStore.skeletons.putJson(updated.id, newVersion, updated)
    updated
  }

  def duplicate(tracing: SkeletonTracing): Box[SkeletonTracing] = {
    val id = createNewId()
    val newTracing = tracing.copy(id = id, name = s"tracing_$id", timestamp = System.currentTimeMillis())
    tracingDataStore.skeletons.putJson(newTracing.id, 0, newTracing)
    Some(newTracing)
  }
}
