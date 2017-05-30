/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester

import com.scalableminds.braingames.binary.models._
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.config.Config
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.concurrent.Execution.Implicits._

import scala.collection.mutable
import scala.concurrent._
import scala.concurrent.duration._

class LayerLocker extends FoxImplicits {

  case class LockObject(id: String)

  private val lockObjects = mutable.HashMap.empty[String, LockObject]

  private def layer2String(dataSource: DataSource, layer: DataLayer) = {
    dataSource.id + "_#_" + layer.name
  }

  private def getLockObject(dataSource: DataSource, layer: DataLayer) = {
    val id = layer2String(dataSource, layer)
    lockObjects.synchronized {
      // TODO: currently we are creating new lock objects all the time, but they will never get removed from the map!
      // Think about an eviction strategy for unused layers
      lockObjects.getOrElseUpdate(id, LockObject(id))
    }
  }

  def withLockFor[A](dataSource: DataSource, layer: DataLayer)(f: () => A): A = {
    val lockObject = getLockObject(dataSource, layer)
    lockObject.synchronized(f())
  }
}

class DataCubeCache(val maxEntries: Int) extends LRUConcurrentCache[CachedCube, Fox[Cube]] {
  override def onElementRemoval(key: CachedCube, value: Fox[Cube]): Unit = {
    value.map(_.scheduleForRemoval())
  }
}

class DataRequester(
  val conf: Config,
  val cache: DataCubeCache,
  dataSourceRepository: DataSourceRepository)
  extends DataReadRequester
    with FoxImplicits
    with LazyLogging {

  val layerLocker = new LayerLocker

  private implicit val dataLoadTimeout = conf.getInt("loadTimeout").seconds

  private implicit val dataSaveTimeout = conf.getInt("saveTimeout").seconds

  private def fallbackForLayer(layer: DataLayer): Fox[DataLayer] = {
    for {
      fallback <- layer.fallback.toFox
      d <- dataSourceRepository.findUsableDataSource(fallback.dataSourceName)
      fallbackLayer <- d.getDataLayer(fallback.layerName)
      if layer.isCompatibleWith(fallbackLayer)
    } yield {
      fallbackLayer
    }
  }

  private def emptyResult(bucket: BucketPosition, request: DataReadRequest) = {
    val halfByteFactor = if(request.settings.useHalfByte) 2 else 1
    Fox.successful(new Array[Byte](bucket.volume * request.dataLayer.bytesPerElement / halfByteFactor))
  }

  protected def handleBucketReadRequest(bucket: BucketPosition, request: DataReadRequest) = {
    val point = request.cuboid.topLeft
    if (point.x < 0 || point.y < 0 || point.z < 0) {
      emptyResult(bucket, request)
    } else {
      loadBucketOfRequest(bucket, request, useCache = true)
    }
  }

  def handleReadRequest(request: DataReadRequest): Fox[Array[Byte]] = {
    def isSingleBucketRequest = {
      request.cuboid.width == request.dataLayer.lengthOfLoadedBuckets &&
        request.cuboid.height == request.dataLayer.lengthOfLoadedBuckets &&
        request.cuboid.depth == request.dataLayer.lengthOfLoadedBuckets &&
        request.cuboid.topLeft == request.cuboid.topLeft.toBucket(request.dataLayer.lengthOfLoadedBuckets).topLeft
    }

    if (isSingleBucketRequest) {
      request.cuboid.allBucketsInCuboid(request.dataLayer.lengthOfLoadedBuckets).headOption.toFox.flatMap { bucket =>
        handleBucketReadRequest(bucket, request)
      }
    } else {
      requestCuboidData(request)
    }
  }

  def handleWriteRequest(request: DataWriteRequest): Fox[Array[Byte]] = {
    Future(blocking(layerLocker.withLockFor(request.dataSource, request.dataLayer){() =>
      // TODO: hacky (we are not using bucket length here). This assumes the data requester can handle the request!
      val bucket = request.cuboid.topLeft.toBucket(request.cuboid.width)
      synchronousSave(request, request.dataLayer, bucket)
    }))
  }


  def loadBucketOfRequest(bucket: BucketPosition, request: DataReadRequest, useCache: Boolean): Fox[Array[Byte]] = {

    def loadFromLayers(layers: List[DataLayer]): Fox[Array[Byte]] = layers match {
      case layer :: tail =>
        val bucketRead = BucketReadInstruction(request.dataSource, layer, bucket, request.settings)
        loadFromLayer(bucketRead, useCache).futureBox.flatMap {
          case Full(byteArray) =>
            Fox.successful(byteArray)
          case f: Failure =>
            logger.error(s"DataStore Failure: ${f.msg}")
            emptyResult(bucket, request)
          case _ =>
            loadFromLayers(tail)
        }
      case _ =>
        // We couldn't find the data in any section. Hence let's assume there is none
        emptyResult(bucket, request)
    }

    fallbackForLayer(request.dataLayer).futureBox.flatMap { fallback =>
      val layers = List(Full(request.dataLayer), fallback).flatten
      loadFromLayers(layers)
    }
  }

  private def loadFromLayer(bucketRead: BucketReadInstruction, useCache: Boolean): Fox[Array[Byte]] = {
    if (bucketRead.dataLayer.doesContainBucket(bucketRead.position)) {
      val shouldCache = useCache && !bucketRead.dataLayer.isUserDataLayer
      bucketRead.dataLayer.bucketHandler(cache).load(bucketRead, dataLoadTimeout, shouldCache)
    } else {
      Fox.empty
    }
  }

  def synchronousSave(
    request: DataWriteRequest,
    layer: DataLayer,
    bucket: BucketPosition): Box[Array[Byte]] = {

    try {
      val f = saveBucket(bucket, request, layer, request.data).map(_ => Array.empty[Byte]).futureBox

      // We will never wait here for ever, since all parts of the feature are upper bounded by Await.result on their own
      Await.result(f, Duration.Inf)
    } catch {
      case e: Exception =>
        logger.error(s"Saving block failed for. Error: $e")
        e.printStackTrace()
        Failure("dataStore.save.synchronousFailed", Full(e), Empty)
    }
  }

  def saveBucket(
    bucket: BucketPosition,
    request: DataWriteRequest,
    layer: DataLayer,
    modifiedData: Array[Byte]): Fox[Boolean] = {

    val saveBucket = BucketWriteInstruction(request.dataSource, layer, bucket, request.version, modifiedData)
    saveToLayer(saveBucket)
  }

  def saveToLayer(saveBucket: BucketWriteInstruction): Fox[Boolean] = {
    if (saveBucket.dataLayer.doesContainBucket(saveBucket.position)) {
      saveBucket.dataLayer.bucketHandler(cache).save(saveBucket, dataSaveTimeout)
    } else {
      Fox.empty
    }
  }
}

trait DataReadRequester {
  this: DataRequester =>

  def requestCuboidData[T](request: DataReadRequest): Fox[Array[Byte]] = {

    val bucketQueue = request.cuboid.allBucketsInCuboid(request.dataLayer.lengthOfLoadedBuckets)

    loadAllBucketsOfRequest(bucketQueue, request).map { rs =>
      // after we have loaded all buckets that 'touch' our cuboid we want to retrieve, we need to cut the data from
      // the loaded buckets
      cutOutCuboid(rs, request)
    }
  }

  /**
    * Given a list of loaded buckets, cutout the data of the cuboid
    */
  private def cutOutCuboid(rs: List[(BucketPosition, Array[Byte])], request: DataReadRequest) = {
    val bytesPerElement = request.dataLayer.bytesPerElement
    val cuboid = request.cuboid
    val result = new Array[Byte](cuboid.volume * bytesPerElement)
    val bucketLength = request.dataLayer.lengthOfLoadedBuckets

    rs.reverse.foreach {
      case (bucket, data) =>
        val x = math.max(cuboid.topLeft.x, bucket.topLeft.x)
        var y = math.max(cuboid.topLeft.y, bucket.topLeft.y)
        var z = math.max(cuboid.topLeft.z, bucket.topLeft.z)

        val xMax = math.min(bucket.topLeft.x + bucketLength, cuboid.bottomRight.x)
        val yMax = math.min(bucket.topLeft.y + bucketLength, cuboid.bottomRight.y)
        val zMax = math.min(bucket.topLeft.z + bucketLength, cuboid.bottomRight.z)

        while (z < zMax) {
          y = math.max(cuboid.topLeft.y, bucket.topLeft.y)
          while (y < yMax) {
            val dataOffset =
              (x % bucketLength +
                y % bucketLength * bucketLength +
                z % bucketLength * bucketLength * bucketLength) * bytesPerElement
            val rx = x - cuboid.topLeft.x
            val ry = y - cuboid.topLeft.y
            val rz = z - cuboid.topLeft.z

            val resultOffset = (rx + ry * cuboid.width + rz * cuboid.width * cuboid.height) * bytesPerElement
            System.arraycopy(data, dataOffset, result, resultOffset, (xMax - x) * bytesPerElement)
            y += 1
          }
          z += 1
        }
    }
    result
  }

  /**
    * Loads all the buckets (where each position is the top-left of the bucket) from the passed layer.
    */
  private def loadAllBucketsOfRequest(buckets: Seq[BucketPosition], request: DataReadRequest) = {
    Fox.serialCombined(buckets.toList) { bucket =>
      handleBucketReadRequest(bucket, request).map(r => bucket -> r)
    }
  }
}
