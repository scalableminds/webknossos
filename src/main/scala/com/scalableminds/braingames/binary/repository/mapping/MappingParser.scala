/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository.mapping

import java.io.{File, FileReader, IOException, Reader}
import java.nio.file.Path

import org.scalastuff.json._
import net.liftweb.common.{Box, Empty, Failure, Full}
import com.scalableminds.braingames.binary.models.DataLayerMapping
import com.typesafe.scalalogging.LazyLogging

class MappingParser extends LazyLogging {

  private val parser = new JsonParser(new MappingBuilder)

  def parse(r: Reader, name: Option[String] = None): Box[DataLayerMapping] = {
    try {
      parser.handler.reset()
      parser.parse(r)
      parser.handler.result
    } catch {
      case e: IOException => 
        logger.error(s"Mapping file could not be read: ${e.getMessage}")
        Failure(s"Mapping file could not be read: ${e.getMessage}")
      case e: IllegalStateException =>
        logger.error(s"Invalid mapping file ('$name'): ${e.getMessage}.")
        Failure(s"Invalid mapping file ('$name'): ${e.getMessage}.")
      case e: JsonParseException =>
        logger.error(s"Json parse exception in mapping ('$name'): ${e.getMessage}.")
        Failure(e.getMessage)
    }
  }

  def parse(s: String): Box[DataLayerMapping] =
    parse(new FileReader(new File(s)), Some(s))

  def parse(p: Path): Box[DataLayerMapping] =
    parse(p.toString)
}

object MappingParser {
  def parse(r: Reader) =
    new MappingParser().parse(r)

  def parse(p: Path) =
    new MappingParser().parse(p)

  def parse(s: String) =
    new MappingParser().parse(s)
}
