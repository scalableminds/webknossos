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

import collection.JavaConverters._
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
        val duration = System.currentTimeMillis - t
        NewRelic.recordResponseTimeMetric(s"Custom/BucketProvider/$className/file-response-time", duration)
        NewRelic.incrementCounter(s"Custom/BucketProvider/$className/files-loaded")
        if (duration > 500) {
          NewRelic.noticeError(s"loading file in $className took too long", Map(
            "duration" -> duration.toString,
            "dataSource" -> readInstruction.dataSource.id.name,
            "dataLayer" -> readInstruction.dataLayer.name,
            "cube" -> readInstruction.cube.toString).asJava)
        }
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
