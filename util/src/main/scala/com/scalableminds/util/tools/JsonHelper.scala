package com.scalableminds.util.tools

import java.io.FileNotFoundException
import java.nio.file._
import com.scalableminds.util.io.FileIO
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import net.liftweb.common._
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.libs.json.Reads._
import play.api.libs.json.Writes._

import java.nio.charset.StandardCharsets
import scala.concurrent.duration._
import scala.io.{BufferedSource, Source}

object JsonHelper extends BoxImplicits with LazyLogging {

  def jsonToFile[A: Writes](path: Path, value: A): Box[Unit] =
    FileIO.printToFile(path.toFile) { printer =>
      printer.print(Json.prettyPrint(Json.toJson(value)))
    }

  def jsonFromFile(path: Path, rootPath: Path): Box[JsValue] =
    if (Files.exists(path) && !Files.isDirectory(path))
      parseJsonFromFile(path, rootPath)
    else
      Failure("Invalid path for json parsing.")

  def validatedJsonFromFile[T: Reads](path: Path, rootPath: Path): Box[T] =
    jsonFromFile(path, rootPath).flatMap(_.validate[T].asOpt)

  private def parseJsonFromFile(path: Path, rootPath: Path): Box[JsValue] = {
    var buffer: BufferedSource = null
    try {
      buffer = Source.fromFile(path.toFile)
      Full(Json.parse(buffer.getLines().mkString))
    } catch {
      case _: java.io.EOFException =>
        logger.warn(s"EOFException in JsonHelper while trying to extract json from file. File: ${rootPath.toString}")
        Failure(s"An EOF exception occurred during json read. File: ${rootPath.relativize(path).toString}")
      case _: AccessDeniedException | _: FileNotFoundException =>
        logger.warn(
          s"File access exception in JsonHelper while trying to extract json from file. File: ${rootPath.toString}")
        Failure(s"Failed to parse Json in '${rootPath.relativize(path).toString}'. Access denied.")
      case e: Exception =>
        logger.warn(s"Json mapping issue in '${rootPath.toString}': $e")
        Failure(s"Failed to parse Json in '${rootPath.relativize(path).toString}': $e")
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
      case Some(t) => implicitly[Writes[T]].writes(t)
      case None    => JsNull
    }
  }

  def parseAndValidateJson[T: Reads](bytes: Array[Byte]): Box[T] =
    parseAndValidateJson[T](new String(bytes, StandardCharsets.UTF_8))

  def parseAndValidateJson[T: Reads](s: String): Box[T] =
    tryo(Json.parse(s))
      .flatMap(parsed => validateJsValue[T](parsed)) ~> "Failed to parse or validate json against data schema"

  def validateJsValue[T: Reads](o: JsValue): Box[T] =
    o.validate[T] match {
      case JsSuccess(parsed, _) =>
        Full(parsed)
      case errors: JsError =>
        Failure("Validating Json Failed: " + JsError.toJson(errors).toString())
    }

  def jsResultToOpt[T](result: JsResult[T]): Option[T] =
    result match {
      case JsSuccess(parsed, _) =>
        Some(parsed)
      case _ =>
        None
    }

  // Sometimes play-json adds a "_type" field to the json-serialized case classes,
  // when it thinks they can’t be distinguished otherwise. We need to remove it manually.
  def removeGeneratedTypeFieldFromJsonRecursively(jsValue: JsValue): JsValue =
    removeKeyRecursively(jsValue, "_type")

  private def removeKeyRecursively(jsValue: JsValue, keyToRemove: String): JsValue =
    jsValue match {
      case JsObject(fields) =>
        val processedAsMap = fields.filter { case (k, _) => k != keyToRemove }.view.mapValues { value: JsValue =>
          removeKeyRecursively(value, keyToRemove)
        }.toMap
        Json.toJson(processedAsMap)
      case JsArray(fields) =>
        Json.toJson(fields.map(value => removeKeyRecursively(value, keyToRemove)))
      case _ => jsValue
    }
}
