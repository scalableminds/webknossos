/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

import java.io.File
import scala.io.Source
import play.api.libs.json._
import net.liftweb.common._
import scalax.file.Path

object JsonHelper{
  lazy val logger = LazyLogger("braingames.json")

  def JsonFromFile(path: Path): Box[JsValue] =
    Box(path.fileOption).flatMap(f => JsonFromFile(f))

  def JsonFromFile(file: File): Box[JsValue] =
    try{
      Full(Json.parse(Source.fromFile(file).getLines.mkString))
    } catch {
      case e: java.io.EOFException =>
        logger.error("EOFException in JsonHelper while trying to extract json from file.", e)
        Failure("An EOF exception occured during json read.")
      case e: Exception  =>
        Failure("Failed to parse Json. Error: "+ e.getMessage)
    }
}