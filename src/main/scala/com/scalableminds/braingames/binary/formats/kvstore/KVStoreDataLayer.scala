/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.formats.kvstore

import java.io.OutputStream

import com.scalableminds.braingames.binary.models.{DataLayer, DataLayerMapping, FallbackLayer}
import com.scalableminds.braingames.binary.requester.DataCubeCache
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
  val cubeLength = 32

  val lengthOfLoadedBuckets = 32

  val baseDir = ""

  def bucketHandler(cache: DataCubeCache) = new KVStoreBucketHandler(cache, KVStoreDataLayer.db)

  def writeTo(outputStream: OutputStream): Unit = {
  }
}

object KVStoreDataLayer {
  val layerType = "kvstore"

  lazy val db = AnnotationStore.volumeStore

  implicit val kvStoreDataLayerFormat = Json.format[KVStoreDataLayer]
}
