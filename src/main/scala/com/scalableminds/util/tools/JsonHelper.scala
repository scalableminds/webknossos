/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

import java.io.File
import java.nio.file._
import scala.io.Source
import play.api.libs.json._
import net.liftweb.common._

object JsonHelper{
  lazy val logger = LazyLogger("braingames.json")

  def JsonFromFile(path: Path): Box[JsValue] = {
    val f = path.toFile
    if(Files.exists(path) && !Files.isDirectory(path))
      JsonFromFile(path.toFile)
    else
      Failure("Invalid path for json parsing.")

  }

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