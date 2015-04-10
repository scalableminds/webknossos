/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository.mapping

import java.io.{File, Reader, FileReader, IOException}
import java.nio.file.Path
import org.scalastuff.json._
import net.liftweb.common.{Failure, Empty, Full, Box}

import com.scalableminds.braingames.binary.models.DataLayerMapping

class MappingParser {

  private val parser = new JsonParser(new MappingBuilder)

  def parse(r: Reader): Box[DataLayerMapping] = {
    try {
      parser.handler.reset()
      parser.parse(r)
      parser.handler.result
    } catch {
      case e: IOException => Failure(s"Mapping file could not be read: ${e.getMessage}")
      case e: IllegalStateException => Failure("Invalid mapping file.")
      case e: JsonParseException => Failure(e.getMessage)
    }
  }

  def parse(s: String): Box[DataLayerMapping] =
    parse(new FileReader(new File(s)))

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
