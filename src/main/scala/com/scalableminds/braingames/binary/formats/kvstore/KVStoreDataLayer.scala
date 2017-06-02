/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.formats.kvstore

import java.io.OutputStream

import com.google.inject.Inject
import com.scalableminds.braingames.binary.models.{DataLayer, DataLayerMapping, FallbackLayer}
import com.scalableminds.braingames.binary.requester.DataCubeCache
import com.scalableminds.braingames.binary.store.AnnotationStore
import com.scalableminds.util.geometry.BoundingBox
import com.typesafe.config.ConfigFactory
import play.api.libs.json.Json
import com.typesafe.scalalogging.LazyLogging
import org.rocksdb.{Options, RocksDB}

case class KVStoreDataLayer(
                             name: String,
                             category: String,
                             elementClass: String = "uint8",
                             isWritable: Boolean = true,
                             fallback: Option[FallbackLayer] = None,
                             resolutions: List[Int],
                             boundingBox: BoundingBox,
                             nextSegmentationId: Option[Long] = None,
                             mappings: List[DataLayerMapping] = Nil,
                             layerType: String = KVStoreDataLayer.layerType
                            ) extends DataLayer with LazyLogging {
  @Inject val store: AnnotationStore = null

  val cubeLength = 32

  val lengthOfLoadedBuckets = 32

  val baseDir = ""

  def bucketHandler(cache: DataCubeCache) = new KVStoreBucketHandler(cache, store.volumeStore)

  def writeTo(outputStream: OutputStream): Unit = {
  }
}

object KVStoreDataLayer {
  val layerType = "kvstore"

  implicit val kvStoreDataLayerFormat = Json.format[KVStoreDataLayer]
}
