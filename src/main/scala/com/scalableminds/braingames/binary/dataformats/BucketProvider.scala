/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.dataformats

import java.util.concurrent.TimeoutException

import com.scalableminds.braingames.binary.models.requests.ReadInstruction
import com.scalableminds.braingames.binary.storage.DataCubeCache
import com.scalableminds.braingames.binary.store.kvstore.VersionedKeyValueStore
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Failure

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{Await, Future}

trait BucketProvider extends FoxImplicits with LazyLogging {

  def loadFromUnderlying(readInstruction: ReadInstruction): Fox[Cube] = Fox.empty

  def load(readInstruction: ReadInstruction, cache: DataCubeCache, tracingDataStore: VersionedKeyValueStore, timeout: FiniteDuration): Fox[Array[Byte]] = {

    def loadFromUnderlyingWithTimeout(readInstruction: ReadInstruction): Fox[Cube] = {
      Future {
        Await.result(loadFromUnderlying(readInstruction).futureBox, timeout)
      }.recover {
        case _: TimeoutException | _: InterruptedException =>
          logger.warn(s"Loading cube timed out. " +
            s"(${readInstruction.dataSource.id.team}/${readInstruction.dataSource.id.name}/${readInstruction.dataLayer.name}, " +
            s"Cube: (${readInstruction.cube.x}, ${readInstruction.cube.y}, ${readInstruction.cube.z})")
          Failure("dataStore.load.timeout")
      }
    }

    cache.withCache(readInstruction)(loadFromUnderlyingWithTimeout)(_.cutOutBucket(readInstruction.dataLayer, readInstruction.bucket))
  }
}
