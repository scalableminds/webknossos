/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

import java.io.FileNotFoundException
import java.nio.file._

import com.scalableminds.util.io.FileIO
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common._
import play.api.libs.json._

import scala.io.{BufferedSource, Source}

object JsonHelper extends LazyLogging {

  def jsonToFile[A : Writes](path: Path, value: A) = {
    FileIO.printToFile(path.toFile) { printer =>
      printer.print(Json.prettyPrint(Json.toJson(value)))
    }
  }

  def jsonFromFile(path: Path, rootPath: Path): Box[JsValue] = {
    if (Files.exists(path) && !Files.isDirectory(path))
      parseJsonFromFile(path, rootPath)
    else
      Failure("Invalid path for json parsing.")
  }

  def validatedJsonFromFile[T : Reads](path: Path, rootPath: Path): Box[T] = {
    jsonFromFile(path, rootPath).flatMap(_.validate[T] match {
      case JsSuccess(value, _) =>
        Full(value)
      case JsError(e) =>
        Failure(s"Invalid json format: $e")
    })
  }

  private def parseJsonFromFile(path: Path, rootPath: Path): Box[JsValue] = {
    var buffer: BufferedSource = null
    try {
      buffer = Source.fromFile(path.toFile)
      Full(Json.parse(buffer.getLines.mkString))
    } catch {
      case e: java.io.EOFException =>
        logger.error(s"EOFException in JsonHelper while trying to extract json from file. File: ${rootPath.relativize(path).toString}")
        Failure(s"An EOF exception occurred during json read. File: ${rootPath.relativize(path).toString}")
      case _: AccessDeniedException | _: FileNotFoundException =>
        logger.error(s"File access exception in JsonHelper while trying to extract json from file. File: ${rootPath.relativize(path).toString}")
        Failure(s"Failed to parse Json in '${rootPath.relativize(path).toString}'. Access denied.")
      case e: com.fasterxml.jackson.databind.JsonMappingException =>
        logger.warn(s"Exception in JsonHelper while trying to extract json from file. Path: $path. Json Mapping issue.")
        Failure(s"Json mapping issue in '${rootPath.relativize(path).toString}'. Cause: ${e.getCause}")
      case e: Exception =>
        logger.error(s"Exception in JsonHelper while trying to extract json from file. Path: $path. Cause: ${e.getCause}")
        Failure(s"Failed to parse Json in '${rootPath.relativize(path).toString}'. Cause: ${e.getCause}")
    } finally {
      if(buffer != null) buffer.close()
    }
  }
}
