package com.scalableminds.webknossos.datastore.storage

import java.io._
import java.nio.file.Path

import com.google.gson.JsonParseException
import com.google.gson.stream.JsonReader
import com.scalableminds.webknossos.datastore.models.datasource.DataLayerMapping
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Failure}

import scala.collection.mutable

object CumsumParser extends LazyLogging {

  def parse(r: Reader): (BoundingBoxFinder, BoundingBoxCache) =
    try {
      parseImpl(r)
    } catch {
      case e: JsonParseException =>
        logger.error(s"Parse exception while parsing mapping: ${e.getMessage}.")
        //Failure(e.getMessage)
        throw e
      case e: Exception =>
        logger.error(s"Unknown exception while parsing mapping: ${e.getMessage}.")
        //Failure(e.getMessage)
        throw e
    } finally {
      r.close()
    }

  def parse(f: File): (BoundingBoxFinder, BoundingBoxCache) =
    parse(new FileReader(f))

  private def parseImpl(r: Reader) = {
    val start = System.currentTimeMillis()

    val jsonReader = new JsonReader(r)
    var boundingBoxList = List[(Long, Long, Long, Long, Long, Long)]()
    val boundingBoxFinder = BoundingBoxFinder(new java.util.TreeSet(), new java.util.TreeSet(), new java.util.TreeSet())
    val boundingBoxCache = new BoundingBoxCache(10000)

    jsonReader.beginObject()
    while (jsonReader.hasNext) {
      jsonReader.nextName() match {
        case "max_ids" =>
          boundingBoxList = parseBoundingBoxes(jsonReader)
        case "cumsum" =>
          parseCumSum(jsonReader, boundingBoxList, boundingBoxFinder, boundingBoxCache)
        case _ =>
          jsonReader.skipValue()
      }
    }
    jsonReader.endObject()

    val end = System.currentTimeMillis()
    logger.info(s"Cumsum parsing took ${end - start} ms")

    (boundingBoxFinder, boundingBoxCache)
  }

  private def parseBoundingBoxes(reader: JsonReader): List[(Long, Long, Long, Long, Long, Long)] = {
    val formRx = "([0-9]+)_([0-9]+)_([0-9]+)_([0-9]+)_([0-9]+)_([0-9]+)".r
    val list = mutable.MutableList[(Long, Long, Long, Long, Long, Long)]()
    reader.beginObject()
    while (reader.hasNext) {
      reader.nextName() match {
        case formRx(x, y, z, w, h, d) =>
          list += ((x.toLong, y.toLong, z.toLong, w.toLong, h.toLong, d.toLong))
          reader.nextLong()
      }
    }
    reader.endObject()
    list.sorted.toList
  }

  private def parseCumSum(reader: JsonReader,
                          boundingBoxes: List[(Long, Long, Long, Long, Long, Long)],
                          boundingBoxFinder: BoundingBoxFinder,
                          boundingBoxCache: BoundingBoxCache) = {
    def addToFinder(bb: (Long, Long, Long, Long, Long, Long)) = {
      boundingBoxFinder.xCoordinates.add(bb._1)
      boundingBoxFinder.yCoordinates.add(bb._2)
      boundingBoxFinder.zCoordinates.add(bb._3)
    }

    def iter(list: List[(Long, Long, Long, Long, Long, Long)], prevEnd: Long): Unit =
      list match {
        case head :: tail if reader.hasNext =>
          addToFinder(head)
          val newEnd = reader.nextLong()
          val currValues = BoundingBoxValues((prevEnd + 1, newEnd), (head._4, head._5, head._6))
          boundingBoxCache.put((head._1, head._2, head._3), currValues)
          iter(tail, newEnd)
        case _ => ()
      }
    reader.beginArray()
    val head = boundingBoxes.head
    boundingBoxCache.minBoundingBox = (head._1, head._2, head._3)
    iter(boundingBoxes, 0)
    reader.endArray()
  }
}
