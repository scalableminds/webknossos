/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.nio.file.Path

import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.braingames.binary.store.FileDataStore

import scala.collection.breakOut
import scala.concurrent.{ExecutionContext, Future, Promise}
import scala.math.pow
import com.scalableminds.util.tools.{BlockedArray3D, Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Full}
import play.api.libs.concurrent.Execution.Implicits._

object KnossosMultiResCreator extends LazyLogging with FoxImplicits{
  val CubeSize = 128

  def fileSize(bytesPerElement: Int) = CubeSize * CubeSize * CubeSize * bytesPerElement

  val Parallelism = 4

  val InterpolationNeighbours = Array((0,0,0), (0,0,1), (0,1,0), (0,1,1), (1,0,0), (1,0,1), (1,1,0), (1,1,1)).map(Point3D.apply)

  @inline
  private def byteToUnsignedInt(b: Byte): Int = 0xff & b.asInstanceOf[Int]

  private def downScale(data: BlockedArray3D[Byte], width: Int, height: Int, depth: Int, bytesPerElement: Int ) = {
    // must be super fast is it is called for each pixel
    @inline
    def average(elements: Array[Array[Byte]]) = {
      val sum = Array.fill(bytesPerElement)(0)
      val result = new Array[Byte](bytesPerElement)

      var i = 0
      while(i < bytesPerElement){
        var idx = 0
        while(idx < elements.length){
          sum(i) = sum(i) + byteToUnsignedInt(elements(idx)(i))
          idx += 1
        }
        result(i) = (sum(i) / elements.length).toByte
        i += 1
      }
      result
    }

    val size = width * height * depth
    val result = new Array[Byte](size * bytesPerElement)
    var idx = 0
    while(idx < size){
      val base = Point3D(idx % width, idx / width % height, idx / width / height)
      val points = InterpolationNeighbours.map{ movement =>
        data(base.scale(2).move(movement))
      }
      average(points).copyToArray(result, idx * bytesPerElement)
      idx += 1
    }
    result
  }

  private def loadCubes(dataStore: FileDataStore,
                        target: Path,
                        dataSetId: String,
                        start: Point3D,
                        resolution: Int,
                        fileSize: Int,
                        neighbours: Array[Point3D]): Future[List[Array[Byte]]] = {
    Future.traverse(neighbours.toList){ movement =>
      val cubePosition = start.move(movement)
      dataStore.load(target, dataSetId, resolution, cubePosition, fileSize, isCompressed = false).futureBox.map{
        case Full(data) =>
          data.padTo(fileSize, 0.toByte)
        case _ =>
          Array.fill(fileSize)(0.toByte)
      }
    }
  }

  def createResolutions(source: Path,
                        target: Path,
                        dataSetId: String,
                        bytesPerElement: Int,
                        baseResolution: Int,
                        resolutions: Int,
                        boundingBox: BoundingBox,
                        progressHook: Double => Unit): Future[_] = {
    def createNextResolution(resolution: Int) = {
      val targetResolution = resolution * 2
      logger.info(s"About to create resolution $targetResolution for $dataSetId")
      val dataStore = new FileDataStore
      val points = for {
        x <- boundingBox.topLeft.x.to(boundingBox.bottomRight.x, CubeSize * targetResolution)
        y <- boundingBox.topLeft.y.to(boundingBox.bottomRight.y, CubeSize * targetResolution)
        z <- boundingBox.topLeft.z.to(boundingBox.bottomRight.z, CubeSize * targetResolution)
      } yield Point3D(x,y,z)

      val baseScale = 1.toFloat / CubeSize / resolution
      val targetScale = 1.toFloat / CubeSize / targetResolution

      val numberPerGroup = (points.size.toFloat / Parallelism).ceil.toInt

      Future.traverse(points.grouped(numberPerGroup)){ ps => ps.foldLeft(Fox.successful(true)){
        case (f, p) => f.flatMap{ _ =>
          val base = p.scale(baseScale)
          val goal = p.scale(targetScale)
          val size = fileSize(bytesPerElement)
          loadCubes(dataStore, target, dataSetId, base, resolution, size, InterpolationNeighbours).flatMap{ cubes =>
            val block = BlockedArray3D[Byte](cubes.toArray, CubeSize, CubeSize, CubeSize, 2, 2, 2, bytesPerElement, 0)
            val data = downScale(block, CubeSize, CubeSize, CubeSize, bytesPerElement)
            dataStore.save(target, dataSetId, targetResolution, goal, data, shouldBeCompressed = false)
          }
        }}
      }
    }

    val resolutionsToCreate = List.fill(resolutions - 2)(2).scanLeft(baseResolution)(_ * _)
    resolutionsToCreate.foldLeft(Future.successful[Any](1)){ 
      case (previous, resolution) =>
        val progress = 1.0 - 1.0 / pow(resolution + 1, 3)
        previous.flatMap(_ => createNextResolution(resolution)).map(_ => progressHook(progress))
    }
  }
}