/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.formats.rocksdb

import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.requester.{Cube, DataCubeCache}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging

import scala.concurrent.duration.FiniteDuration
import scala.concurrent.ExecutionContext.Implicits._
import com.scalableminds.braingames.binary.requester.handlers.BucketHandler
import net.liftweb.common.{Box, Empty, Full}
import net.liftweb.util.Helpers.tryo
import org.rocksdb.RocksDB

case class RocksDbCube(db: RocksDB, key: Array[Byte]) extends Cube {
  def cutOutBucket(requestedBucket: BucketReadInstruction): Box[Array[Byte]] = {
    val data = db.get(key)
    if (data == null) {
      Empty
    } else {
      Full(data)
    }
  }
}

class RocksDbBucketHandler(val cache: DataCubeCache, val db: RocksDB) extends BucketHandler
  with FoxImplicits
  with LazyLogging {

  private def buildBucketKey(loadBlock: CubeReadInstruction): Array[Byte] = {
    List(
      loadBlock.dataLayer.name,
      loadBlock.position.resolution,
      loadBlock.position.x,
      loadBlock.position.y,
      loadBlock.position.z
    ).mkString("-").toCharArray.map(_.toByte)
  }

  private def buildBucketKey(saveBlock: BucketWriteInstruction): Array[Byte] = {
    List(
      saveBlock.dataLayer.name,
      saveBlock.position.resolution,
      saveBlock.position.x,
      saveBlock.position.y,
      saveBlock.position.z
    ).mkString("-").toCharArray.map(_.toByte)
  }

  override def loadFromUnderlying(loadBlock: CubeReadInstruction, timeout: FiniteDuration): Fox[Cube] = {
    val key = buildBucketKey(loadBlock)
    Fox.successful(new RocksDbCube(db, key))
  }

  override def saveToUnderlying(saveBlock: BucketWriteInstruction, timeout: FiniteDuration): Fox[Boolean] = {
    val key = buildBucketKey(saveBlock)
    tryo {
      db.put(key, saveBlock.data)
      true
    }
  }
}
