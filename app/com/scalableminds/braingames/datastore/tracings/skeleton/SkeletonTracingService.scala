package com.scalableminds.braingames.datastore.tracings.skeleton

import com.google.inject.Inject
import com.scalableminds.braingames.binary.models.datasource.DataSource
import com.scalableminds.braingames.binary.store.kvstore.VersionedKeyValueStore
import com.scalableminds.braingames.datastore.tracings.skeleton.elements.SkeletonTracing
import com.scalableminds.util.geometry.Scale
import net.liftweb.common.{Box, Full}
import play.api.libs.json.JsValue

/**
  * Created by f on 28.06.17.
  */
class SkeletonTracingService @Inject()(
                                        implicit val tracingDataStore: VersionedKeyValueStore
                                      ) {

  var dummyTracing: SkeletonTracing = SkeletonTracing(name = "DummyTracing",
    dataSetName = "DummyDatasetName",
    trees = List(),
    timestamp = System.currentTimeMillis(),
    activeNodeId = None,
    scale = new Scale(1,1,1),
    editPosition = None,
    editRotation = None,
    zoomLevel = None)

  def findSkeletonTracing(annotationId: String): SkeletonTracing = dummyTracing

  def create(dataSource: DataSource): SkeletonTracing = {
    dummyTracing
  }

  def info(tracing: SkeletonTracing): JsValue = ???

  def update(tracing: SkeletonTracing, updates: List[SkeletonUpdateAction]): Box[Unit] = {
    for (update <- updates)
      dummyTracing = update.applyOn(dummyTracing)
    Full(())
  }

  def download(tracing: SkeletonTracing): Box[Array[Byte]] = ???

  def duplicate(tracing: SkeletonTracing): Box[SkeletonTracing] = ???

}
