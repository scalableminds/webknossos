package com.scalableminds.webknossos.datastore.storage

import com.google.gson.JsonParseException
import com.google.gson.stream.JsonReader
import com.scalableminds.util.time.Instant
import com.typesafe.scalalogging.LazyLogging

import java.io._
import java.util
import scala.annotation.tailrec
import scala.collection.mutable

object CumsumParser extends LazyLogging {

  // the cumsum json object contains "max_ids" and "cumsum"
  // the jsonReader can only go through the file in forward direction, but we need max_ids first
  // if the json contains cumsum first, it is skipped at first and parseImpl will call itself again to read it second
  def parseImpl(f: File,
                maxReaderRange: Long,
                initialBoundingBoxList: List[(Long, Long, Long, Long, Long, Long)],
                before: Instant): BoundingBoxCache = {
    val r = new FileReader(f)
    try {
      val jsonReader = new JsonReader(r)
      var boundingBoxList = initialBoundingBoxList
      val positionSets = (new java.util.TreeSet[Long](), new java.util.TreeSet[Long](), new java.util.TreeSet[Long]())
      var cache = mutable.HashMap[(Long, Long, Long), BoundingBoxValues]()
      var minBoundingBox: (Long, Long, Long) = (0, 0, 0)
      var correctOrder = true

      jsonReader.beginObject()
      while (jsonReader.hasNext) {
        jsonReader.nextName() match {
          case "max_ids" if boundingBoxList.isEmpty =>
            boundingBoxList = parseBoundingBoxes(jsonReader)
          case "cumsum" =>
            if (boundingBoxList.nonEmpty) {
              val tuple = parseCumSum(jsonReader, boundingBoxList, positionSets)
              cache = tuple._1
              minBoundingBox = tuple._2
            } else {
              correctOrder = false
              jsonReader.skipValue()
            }
          case _ =>
            jsonReader.skipValue()
        }
      }
      jsonReader.endObject()

      if (!correctOrder) {
        parseImpl(f, maxReaderRange, boundingBoxList, before)
      } else {
        Instant.logSince(before, s"Cumsum JSON parsing", logger)
        new BoundingBoxCache(cache,
                             BoundingBoxFinder(positionSets._1, positionSets._2, positionSets._3, minBoundingBox),
                             maxReaderRange)
      }
    } catch {
      case e: JsonParseException =>
        logger.error(s"Parse exception while parsing cumsum: ${e.getMessage}.")
        throw e
    } finally {
      r.close()
    }
  }

  def parse(f: File, maxReaderRange: Long): BoundingBoxCache =
    parseImpl(f, maxReaderRange, List(), Instant.now)

  private def parseBoundingBoxes(reader: JsonReader): List[(Long, Long, Long, Long, Long, Long)] = {
    val formRx = "([0-9]+)_([0-9]+)_([0-9]+)_([0-9]+)_([0-9]+)_([0-9]+)".r
    val list = mutable.ListBuffer[String]()
    reader.beginObject()
    while (reader.hasNext) {
      list += reader.nextName()
      reader.nextLong()
    }
    reader.endObject()
    list.sorted.map { case formRx(x, y, z, w, h, d) => (x.toLong, y.toLong, z.toLong, w.toLong, h.toLong, d.toLong) }.toList
  }

  private def parseCumSum(reader: JsonReader,
                          boundingBoxes: List[(Long, Long, Long, Long, Long, Long)],
                          positionSets: (util.TreeSet[Long], util.TreeSet[Long], util.TreeSet[Long])) = {
    def addToFinder(bb: (Long, Long, Long, Long, Long, Long)) = {
      positionSets._1.add(bb._1)
      positionSets._2.add(bb._2)
      positionSets._3.add(bb._3)
    }

    @tailrec
    def iter(list: List[(Long, Long, Long, Long, Long, Long)],
             hashMap: mutable.HashMap[(Long, Long, Long), BoundingBoxValues],
             prevEnd: Long): Unit =
      list match {
        case head :: tail if reader.hasNext =>
          addToFinder(head)
          val newEnd = reader.nextLong()
          val currValues = BoundingBoxValues((prevEnd + 1, newEnd), (head._4, head._5, head._6))
          hashMap put ((head._1, head._2, head._3), currValues)
          iter(tail, hashMap, newEnd)
        case _ => ()
      }
    val hashMap = mutable.HashMap[(Long, Long, Long), BoundingBoxValues]()
    reader.beginArray()
    val minElement = boundingBoxes.min
    val minBoundingBox = (minElement._1, minElement._2, minElement._3)
    iter(boundingBoxes, hashMap, 0)
    reader.endArray()
    (hashMap, minBoundingBox)
  }
}
