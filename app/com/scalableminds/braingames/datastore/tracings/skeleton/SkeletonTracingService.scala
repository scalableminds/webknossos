package com.scalableminds.braingames.datastore.tracings.skeleton

import java.util.UUID

import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.braingames.binary.models.datasource.DataSource
import com.scalableminds.braingames.binary.store.kvstore.VersionedKeyValueStore
import com.scalableminds.braingames.datastore.tracings.skeleton.elements.SkeletonTracing
import com.scalableminds.braingames.datastore.tracings.skeleton.elements.SkeletonTracing.SkeletonTracingXMLWrites
import com.scalableminds.util.geometry.Scale
import com.scalableminds.util.tools.Fox
import net.liftweb.common.{Box, Full}
import play.api.libs.iteratee.Enumerator
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsValue, Json}

/**
  * Created by f on 28.06.17.
  */
class SkeletonTracingService @Inject()(
                                        @Named("tracing-data-store") implicit val tracingDataStore: VersionedKeyValueStore
                                      ) {

  private def buildTracingKey(id: String): String = s"/tracings/skeletons/$id"
  private def createNewId(): String = UUID.randomUUID.toString

  def find(tracingId: String, version: Option[Long] = None): Box[SkeletonTracing] =
    tracingDataStore.getJson[SkeletonTracing](buildTracingKey(tracingId), version).map(_.value)

  def create(): SkeletonTracing = {
    val tracing = SkeletonTracing(
      id = createNewId(),
      name = "DummyTracing",
      dataSetName = "DummyDatasetName",
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

  def update(tracing: SkeletonTracing, updates: List[SkeletonUpdateAction]): Box[Unit] = {
    def updateIter(tracing: SkeletonTracing, remainingUpdates: List[SkeletonUpdateAction]): SkeletonTracing = remainingUpdates match {
      case List() => tracing
      case update :: tail => updateIter(update.applyOn(tracing), tail)
    }
    val updated = updateIter(tracing, updates)
    tracingDataStore.putJson(buildTracingKey(updated.id), 2, updated)
    Full(())
  }

  def downloadJson(tracing: SkeletonTracing): Box[JsValue] = {
    Some(Json.toJson(tracing))
  }

  def downloadNML(tracing: SkeletonTracing): Fox[Enumerator[Array[Byte]]] = {
    Fox.successful(Enumerator.outputStream { os =>
      NMLWriter.toNML(tracing, os)(SkeletonTracingXMLWrites).map(_ => os.close())
    })
  }

  def duplicate(tracing: SkeletonTracing): Box[SkeletonTracing] = ???

}
