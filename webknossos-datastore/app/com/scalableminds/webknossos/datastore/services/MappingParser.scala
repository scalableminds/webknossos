package com.scalableminds.webknossos.datastore.services

import java.io._
import java.nio.file.Path

import net.liftweb.common.{Box, Empty, Failure, Full}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayerMapping
import com.typesafe.scalalogging.LazyLogging
import com.google.gson.JsonParseException
import com.google.gson.stream.JsonReader

import scala.collection.mutable

object MappingParser  extends LazyLogging {
  def parse(r: Reader): Box[DataLayerMapping] = {
    try {
      parseImpl(r)
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
  }

  def parse(p: Path): Box[DataLayerMapping] =
    parse(new FileReader(new File(p.toString)))

  def parse(a: Array[Byte]): Box[DataLayerMapping] =
    parse(new InputStreamReader(new ByteArrayInputStream(a)))

  private def parseImpl(r: Reader): Box[DataLayerMapping] = {
    val jsonReader = new JsonReader(r)
    var nameOpt: Option[String] = None
    var classesOpt: Option[Map[Long, Long]] = None

    jsonReader.beginObject()
    while (jsonReader.hasNext) {
      jsonReader.nextName() match {
        case "name" =>
          nameOpt = Some(jsonReader.nextString())
        case "classes" =>
          classesOpt = Some(parseClasses(jsonReader))
        case _ =>
          jsonReader.skipValue()
      }
    }
    jsonReader.endObject()

    for {
      name <- nameOpt
      classes <- classesOpt
    } yield {
      DataLayerMapping(name, classes)
    }
  }

  private def parseClasses(jsonReader: JsonReader): Map[Long, Long] = {
    val mapping = mutable.HashMap[Long, Long]()

    jsonReader.beginArray()

    while (jsonReader.hasNext()) {
      jsonReader.beginArray()
      var firstIdOpt: Option[Long] = None

      while (jsonReader.hasNext()) {
        val currentId = jsonReader.nextLong()
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
