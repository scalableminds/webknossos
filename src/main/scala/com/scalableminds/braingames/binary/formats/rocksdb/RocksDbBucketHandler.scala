/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.formats.rocksdb

import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.requester.handlers.BucketHandler
import com.scalableminds.braingames.binary.requester.{Cube, DataCubeCache}
import com.scalableminds.braingames.binary.store.kvstore.VersionedKeyValueStore
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box

import scala.concurrent.ExecutionContext.Implicits._
import scala.concurrent.duration.FiniteDuration

case class RocksDbCube(db: VersionedKeyValueStore, key: String) extends Cube {
  def cutOutBucket(requestedBucket: BucketReadInstruction): Box[Array[Byte]] = {
    db.get(key).map(_.value)
  }
}

class RocksDbBucketHandler(val cache: DataCubeCache, val db: VersionedKeyValueStore) extends BucketHandler
  with FoxImplicits
  with LazyLogging {

  private def mortonEncode(x: Long, y: Long, z: Long): Long = {
    var morton = 0L
    val bitLength = math.ceil(math.log(List(x, y, z).max + 1) / math.log(2)).toInt

    (0 until bitLength).foreach { i =>
      morton |= ((x & (1L << i)) << (2 * i)) |
        ((y & (1L << i)) << (2 * i + 1)) |
        ((z & (1L << i)) << (2 * i + 2))
    }
    morton
  }

  private def buildBucketKey(dataLayerName: String, resolution: Int, x: Long, y: Long, z: Long): String = {
    val mortonIndex = mortonEncode(x, y, z)
    s"${dataLayerName}-${resolution}-${mortonIndex}-${x}_${y}_${z}"
  }

  override def loadFromUnderlying(loadBlock: CubeReadInstruction, timeout: FiniteDuration): Fox[Cube] = {
    val key = buildBucketKey(
      loadBlock.dataLayer.name,
      loadBlock.position.resolution,
      loadBlock.position.x,
      loadBlock.position.y,
      loadBlock.position.z)
    Fox.successful(new RocksDbCube(db, key))
  }

  override def saveToUnderlying(saveBlock: BucketWriteInstruction, timeout: FiniteDuration): Fox[Boolean] = {
    val key = buildBucketKey(
      saveBlock.dataLayer.name,
      saveBlock.position.resolution,
      saveBlock.position.x,
      saveBlock.position.y,
      saveBlock.position.z)
    db.put(key, saveBlock.version, saveBlock.data).map(_ => true)
  }
}
