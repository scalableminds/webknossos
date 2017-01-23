/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.nio.file.Path

import com.scalableminds.braingames.binary.requester.DataRequester
import com.scalableminds.braingames.binary.models.{DataLayer, DataSource}
import com.scalableminds.braingames.binary.store.FileDataStore
import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.util.tools.{BlockedArray3D, Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Full
import play.api.libs.concurrent.Execution.Implicits._

import scala.annotation.tailrec
import scala.concurrent.Future
import scala.math.pow

class KnossosMultiResCreator(dataRequester: DataRequester)
  extends LazyLogging
    with FoxImplicits {

  val Parallelism = 4

  private def downScale(data: BlockedArray3D[Byte], width: Int, height: Int, depth: Int, bytesPerElement: Int) = {
    @inline
    def byteToUnsignedInt(b: Byte): Int = 0xff & b.asInstanceOf[Int]

    @inline
    def average(l: List[Array[Byte]], offset: Int) = {
      @tailrec
      def summup(l: List[Array[Byte]], accum: Int = 0): Int = {
        l match {
          case head :: Nil =>
            accum + byteToUnsignedInt(head(offset))
          case head :: tail =>
            summup(tail, accum + byteToUnsignedInt(head(offset)))
          case Nil =>
            accum
        }
      }
      if(l.isEmpty)
        0.toByte
      else
        (summup(l) / l.size).toByte
    }

    // must be super fast is it is called for each pixel

    val size = width * height * depth
    val result = new Array[Byte](size * bytesPerElement)
    var idx = 0
    while (idx < size) {
      val x = (idx % width) * 2 - 1
      val y = (idx / width % height) * 2 - 1
      val z = (idx / width / height) * 2 - 1
      var i = 0
      var sum = List.empty[Array[Byte]]
      while (i < 8) {
        val xi = x + (i % 2)
        val yi = y + ((i / 2) % 2)
        val zi = z + i / 2 / 2
        if(xi >= 0 && yi >= 0 && zi >= 0){
          val blockIdx = data.calculateBlockIdx(xi, yi, zi)
          if(data.exists(blockIdx)) {
            val d = data.getBytes(xi, yi, zi, data.underlying(blockIdx))
            sum ::= d
          }
        }
        i += 1
      }

      var j = 0
      while (j < bytesPerElement) {
        result(idx * bytesPerElement + j) = average(sum, j)
        j += 1
      }
      idx += 1
    }
    result
  }

  def createResolutions(dataSource: DataSource,
                        layer: DataLayer,
                        source: Path,
                        target: Path,
                        baseResolution: Int,
                        resolutions: Int,
                        boundingBox: BoundingBox,
                        progressHook: Double => Unit): Future[_] = {
    def createNextResolution(resolution: Int) = {
      val s = System.currentTimeMillis()
      val targetResolution = resolution * 2
      logger.info(s"About to create resolution $targetResolution for ${dataSource.id}")
      val dataStore = new FileDataStore
      val points = for {
        x <- boundingBox.topLeft.x.to(boundingBox.bottomRight.x, dataSource.blockLength * targetResolution)
        y <- boundingBox.topLeft.y.to(boundingBox.bottomRight.y, dataSource.blockLength * targetResolution)
        z <- boundingBox.topLeft.z.to(boundingBox.bottomRight.z, dataSource.blockLength * targetResolution)
      } yield Point3D(x, y, z)

      val baseScale = 1.toFloat / dataSource.blockLength / resolution
      val targetScale = 1.toFloat / dataSource.blockLength / targetResolution

      points.foldLeft(Fox.successful(true)) {
        case (f, p) => f.flatMap { _ =>
          val minBlock = p.scale(baseScale)
          val maxBlock = p.scale(baseScale).move(1, 1, 1)
          val goal = p.scale(targetScale)
          val combinedF: Fox[Array[Array[Byte]]] =
            Fox.combined(dataRequester.loadBlocks(
              minBlock, maxBlock, dataSource, None, resolution, layer, useCache = true))

          combinedF.flatMap { cubes =>
            val block = BlockedArray3D[Byte](
              cubes, dataSource.blockLength, dataSource.blockLength,
              dataSource.blockLength, 2, 2, 2, layer.bytesPerElement, 0)
            val data = downScale(
              block, dataSource.blockLength, dataSource.blockLength,
              dataSource.blockLength, layer.bytesPerElement)
            dataStore.save(target, dataSource.id, targetResolution, goal, data, shouldBeCompressed = false)
          }
        }
      } .map { r =>
        logger.info("Finished creating resolutions! Time: " + ((System.currentTimeMillis() - s) / 1000).toInt + " s")
        r
      }
    }

    val resolutionsToCreate = List.fill(resolutions - 2)(2).scanLeft(baseResolution)(_ * _)
    resolutionsToCreate.foldLeft(Future.successful[Any](1)) {
      case (previous, resolution) =>
        val progress = 1.0 - 1.0 / pow(resolution + 1, 3)
        previous.flatMap(_ => createNextResolution(resolution)).map(_ => progressHook(progress))
    }
  }
}