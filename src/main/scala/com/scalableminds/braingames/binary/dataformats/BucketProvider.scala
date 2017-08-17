/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.dataformats

import java.util.concurrent.TimeoutException

import com.newrelic.api.agent.NewRelic
import com.scalableminds.braingames.binary.models.BucketPosition
import com.scalableminds.braingames.binary.models.requests.DataReadInstruction
import com.scalableminds.braingames.binary.storage.DataCubeCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Failure

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{Await, Future}

trait BucketProvider extends FoxImplicits with LazyLogging {

  def loadFromUnderlying(readInstruction: DataReadInstruction): Fox[Cube] = Fox.empty

  def load(readInstruction: DataReadInstruction, cache: DataCubeCache, timeout: FiniteDuration): Fox[Array[Byte]] = {

    def loadFromUnderlyingWithTimeout(readInstruction: DataReadInstruction): Fox[Cube] = {
      Future {
        val t = System.currentTimeMillis
        val className = this.getClass.getName.split("\\.").last
        val result = Await.result(loadFromUnderlying(readInstruction).futureBox, timeout)
        NewRelic.recordResponseTimeMetric(s"Custom/BucketProvider/$className/file-response-time", System.currentTimeMillis - t)
        NewRelic.incrementCounter(s"Custom/FileDataStore/$className/files-loaded")
        result
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

  def bucketStream(resolution: Int): Iterator[(BucketPosition, Array[Byte])] = Iterator.empty
}
