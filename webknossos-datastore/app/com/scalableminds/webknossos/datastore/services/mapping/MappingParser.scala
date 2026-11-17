package com.scalableminds.webknossos.datastore.services.mapping

import com.google.gson.JsonParseException
import com.google.gson.stream.JsonReader
import com.scalableminds.util.box.{Box, Failure}
import com.scalableminds.util.time.Instant
import com.scalableminds.webknossos.datastore.models.datasource.DataLayerMapping
import com.typesafe.scalalogging.LazyLogging

import java.io.*
import scala.collection.mutable

object MappingParser extends LazyLogging {

  def parse(r: Reader, normalizeId: Long => Long): Box[DataLayerMapping] =
    try
      Box.fromOption(parseImpl(r, normalizeId))
    catch {
      case e: JsonParseException =>
        logger.error(s"Parse exception while parsing mapping: ${e.getMessage}.")
        Failure(e.getMessage)
      case e: Exception =>
        logger.error(s"Unknown exception while parsing mapping: ${e.getMessage}.")
        Failure(e.getMessage)
    } finally
      r.close()

  def parse(a: Array[Byte], normalizeId: Long => Long): Box[DataLayerMapping] =
    parse(new InputStreamReader(new ByteArrayInputStream(a)), normalizeId)

  private def parseImpl(r: Reader, normalizeId: Long => Long): Option[DataLayerMapping] = {
    val before = Instant.now

    val jsonReader = new JsonReader(r)
    var nameOpt: Option[String] = None
    var classesOpt: Option[Map[Long, Long]] = None

    jsonReader.beginObject()
    while (jsonReader.hasNext)
      jsonReader.nextName() match {
        case "name" =>
          nameOpt = Some(jsonReader.nextString())
        case "classes" =>
          classesOpt = Some(parseClasses(jsonReader, normalizeId))
        case _ =>
          jsonReader.skipValue()
      }
    jsonReader.endObject()

    Instant.logSince(before, "JSON Mapping parsing", logger)

    for {
      name <- nameOpt
      classes <- classesOpt
    } yield DataLayerMapping(name, classes)
  }

  private def parseClasses(jsonReader: JsonReader, normalizeId: Long => Long): Map[Long, Long] = {
    val mapping = mutable.HashMap[Long, Long]()

    jsonReader.beginArray()

    while (jsonReader.hasNext) {
      jsonReader.beginArray()
      var firstIdOpt: Option[Long] = None

      while (jsonReader.hasNext) {
        val currentId = normalizeId(jsonReader.nextLong())
        firstIdOpt match {
          case Some(firstId) =>
            mapping.put(currentId, firstId)
          case _ =>
            firstIdOpt = Some(currentId)
        }
      }

      jsonReader.endArray()
    }

    jsonReader.endArray()
    mapping.toMap
  }
}
