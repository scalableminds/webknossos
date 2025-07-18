package com.scalableminds.webknossos.datastore.services.mapping

import com.google.gson.JsonParseException
import com.google.gson.stream.JsonReader
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Box, Failure}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayerMapping
import com.typesafe.scalalogging.LazyLogging

import java.io._
import java.nio.file.Path
import scala.collection.mutable

object MappingParser extends LazyLogging {

  def parse[T](r: Reader, fromLongFn: Long => T): Box[DataLayerMapping[T]] =
    try {
      Box(parseImpl(r, fromLongFn))
    } catch {
      case e: JsonParseException =>
        logger.error(s"Parse exception while parsing mapping: ${e.getMessage}.")
        Failure(e.getMessage)
      case e: Exception =>
        logger.error(s"Unknown exception while parsing mapping: ${e.getMessage}.")
        Failure(e.getMessage)
    } finally {
      r.close()
    }

  def parse[T](p: Path, fromLongFn: Long => T): Box[DataLayerMapping[T]] =
    parse(new FileReader(new File(p.toString)), fromLongFn)

  def parse[T](a: Array[Byte], fromLongFn: Long => T): Box[DataLayerMapping[T]] =
    parse(new InputStreamReader(new ByteArrayInputStream(a)), fromLongFn)

  private def parseImpl[T](r: Reader, fromLongFn: Long => T): Option[DataLayerMapping[T]] = {
    val before = Instant.now

    val jsonReader = new JsonReader(r)
    var nameOpt: Option[String] = None
    var classesOpt: Option[Map[T, T]] = None

    jsonReader.beginObject()
    while (jsonReader.hasNext) {
      jsonReader.nextName() match {
        case "name" =>
          nameOpt = Some(jsonReader.nextString())
        case "classes" =>
          classesOpt = Some(parseClasses(jsonReader, fromLongFn))
        case _ =>
          jsonReader.skipValue()
      }
    }
    jsonReader.endObject()

    Instant.logSince(before, s"JSON Mapping parsing", logger)

    for {
      name <- nameOpt
      classes <- classesOpt
    } yield {
      DataLayerMapping(name, classes)
    }
  }

  private def parseClasses[T](jsonReader: JsonReader, fromLongFn: Long => T): Map[T, T] = {
    val mapping = mutable.HashMap[T, T]()

    jsonReader.beginArray()

    while (jsonReader.hasNext) {
      jsonReader.beginArray()
      var firstIdOpt: Option[T] = None

      while (jsonReader.hasNext) {
        val currentId = fromLongFn(jsonReader.nextLong())
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
