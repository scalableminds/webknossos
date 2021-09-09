package com.scalableminds.util.tools

import java.io.FileNotFoundException
import java.nio.file._

import com.scalableminds.util.io.FileIO
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common._
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.libs.json.Reads._
import play.api.libs.json.Writes._
import scala.concurrent.ExecutionContext.Implicits._

import scala.concurrent.duration._
import scala.io.{BufferedSource, Source}

object JsonHelper extends BoxImplicits with LazyLogging {

  def jsonToFile[A: Writes](path: Path, value: A) =
    FileIO.printToFile(path.toFile) { printer =>
      printer.print(Json.prettyPrint(Json.toJson(value)))
    }

  def jsonFromFile(path: Path, rootPath: Path): Box[JsValue] =
    if (Files.exists(path) && !Files.isDirectory(path))
      parseJsonFromFile(path, rootPath)
    else
      Failure("Invalid path for json parsing.")

  def validatedJsonFromFile[T: Reads](path: Path, rootPath: Path): Box[T] =
    jsonFromFile(path, rootPath).flatMap(_.validate[T])

  private def parseJsonFromFile(path: Path, rootPath: Path): Box[JsValue] = {
    var buffer: BufferedSource = null
    try {
      buffer = Source.fromFile(path.toFile)
      Full(Json.parse(buffer.getLines.mkString))
    } catch {
      case e: java.io.EOFException =>
        logger.error(
          s"EOFException in JsonHelper while trying to extract json from file. File: ${rootPath.relativize(path).toString}")
        Failure(s"An EOF exception occurred during json read. File: ${rootPath.relativize(path).toString}")
      case _: AccessDeniedException | _: FileNotFoundException =>
        logger.error(
          s"File access exception in JsonHelper while trying to extract json from file. File: ${rootPath.relativize(path).toString}")
        Failure(s"Failed to parse Json in '${rootPath.relativize(path).toString}'. Access denied.")
      case e: com.fasterxml.jackson.databind.JsonMappingException =>
        logger.warn(s"Exception in JsonHelper while trying to extract json from file. Path: $path. Json Mapping issue.")
        Failure(s"Json mapping issue in '${rootPath.relativize(path).toString}'. Cause: ${e.getCause}")
      case e: Exception =>
        logger.error(
          s"Exception in JsonHelper while trying to extract json from file. Path: $path. Cause: ${e.getCause}")
        Failure(s"Failed to parse Json in '${rootPath.relativize(path).toString}'. Cause: ${e.getCause}")
    } finally {
      if (buffer != null) buffer.close()
    }
  }

  def jsError2HumanReadable(js: JsError)(implicit messages: Messages): String =
    js.errors.map {
      case (path, errors) =>
        val errorStr = errors.map(m => Messages(m.message)).mkString(", ")
        s"Error at json path '$path': $errorStr."
    }.mkString("\n")

  implicit def boxFormat[T: Format]: Format[Box[T]] = new Format[Box[T]] {
    override def reads(json: JsValue): JsResult[Box[T]] =
      (json \ "status").validate[String].flatMap {
        case "Full"    => (json \ "value").validate[T].map(Full(_))
        case "Empty"   => JsSuccess(Empty)
        case "Failure" => (json \ "value").validate[String].map(Failure(_))
        case _         => JsError("invalid status")
      }

    override def writes(o: Box[T]): JsValue = o match {
      case Full(t)    => Json.obj("status" -> "Full", "value" -> Json.toJson(t))
      case Empty      => Json.obj("status" -> "Empty")
      case f: Failure => Json.obj("status" -> "Failure", "value" -> f.msg)
    }
  }

  def oFormat[T](format: Format[T]): OFormat[T] = {
    val oFormat: OFormat[T] = new OFormat[T]() {
      override def writes(o: T): JsObject = format.writes(o).as[JsObject]
      override def reads(json: JsValue): JsResult[T] = format.reads(json)
    }
    oFormat
  }

  implicit object FiniteDurationFormat extends Format[FiniteDuration] {
    def reads(json: JsValue): JsResult[FiniteDuration] = LongReads.reads(json).map(_.seconds)
    def writes(o: FiniteDuration): JsValue = LongWrites.writes(o.toSeconds)
  }

  implicit def optionFormat[T: Format]: Format[Option[T]] = new Format[Option[T]] {
    override def reads(json: JsValue): JsResult[Option[T]] = json.validateOpt[T]

    override def writes(o: Option[T]): JsValue = o match {
      case Some(t) ⇒ implicitly[Writes[T]].writes(t)
      case None ⇒ JsNull
    }
  }

  def parseJsonToFox[T: Reads](s: String): Box[T] =
    Json.parse(s).validate[T] match {
      case JsSuccess(parsed, _) =>
        Full(parsed)
      case errors: JsError =>
        Failure("Validating Json Failed: " + JsError.toJson(errors).toString())
    }

  def jsResultToFox[T](result: JsResult[T]): Fox[T] =
    result match {
      case JsSuccess(parsed, _) =>
        Fox.successful(parsed)
      case errors: JsError =>
        Fox.failure("Validating Json Failed: " + JsError.toJson(errors).toString())
    }

  def jsResultToOpt[T](result: JsResult[T]): Option[T] =
    result match {
      case JsSuccess(parsed, _) =>
        Some(parsed)
      case _ =>
        None
    }

  def getJsObjectFieldAsOptional[T: Reads](jsObject: JsObject, key: String): Option[T] =
    jsObject.value.get(key).flatMap(_.validate[T].asOpt)
}
