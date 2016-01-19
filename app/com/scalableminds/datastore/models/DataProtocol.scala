/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.models

import play.api.libs.json._
import play.api.mvc.BodyParsers._
import play.api.mvc.MultipartFormData._
import play.core.parsers.Multipart.PartHandler
import play.api.libs.iteratee._
import play.api.libs.concurrent.Execution.Implicits._
import net.liftweb.common._

import com.scalableminds.util.geometry.Point3D

case class DataProtocolReadRequest(position: Point3D, zoomStep: Int, cubeSize: Int, fourBit: Option[Boolean])

object DataProtocolReadRequest {
  implicit val binaryProtocolReadBucketFormat = Json.format[DataProtocolReadRequest]
}

case class DataProtocolWriteRequestHeader(position: Point3D, zoomStep: Int, cubeSize: Int)

object DataProtocolWriteRequestHeader {
  implicit val binaryProtocolWriteBucketFormat = Json.format[DataProtocolWriteRequestHeader]
}

case class DataProtocolWriteRequest(header: DataProtocolWriteRequestHeader, data: Array[Byte])

object DataProtocol {

  def tryo[T](f: => T): Box[T] = {
      try {
        Full(f)
      } catch {
        case c: Throwable => 
          Failure(c.getMessage)
      }
  }

  def filePart[A](ref: A) = FilePart("", "", None, ref)

  def parseReadHeader(header: Option[String]): Box[DataProtocolReadRequest] = {
    for {
      bucket <- Box(header) ?~ "X-Bucket header is missing."
      json <- tryo(Json.parse(bucket))
      r <- json.validate[DataProtocolReadRequest] match {
        case JsSuccess(r, _) => Full(r)
        case e: JsError => Failure(s"Parsing error: $e")
      }
    } yield {
      r
    }
  }

  def readRequestIteratee(request: DataProtocolReadRequest) = {
    Cont[Array[Byte], FilePart[Box[DataProtocolReadRequest]]] {
      case Input.El(Array()) =>
        Done(filePart(Full(request)), Input.Empty)
      case _ =>
        Done(filePart(Failure("Found unexpected data.")), Input.Empty)
    }
  }


  val readRequestParser = parse.multipartFormData(new PartHandler[FilePart[Box[DataProtocolReadRequest]]]{
    def apply(headers: Map[String, String]) = {
      parseReadHeader(headers.get("x-bucket")) match {
        case Full(r) => readRequestIteratee(r)
        case f: Failure => Done[Array[Byte], FilePart[Box[DataProtocolReadRequest]]](filePart(f), Input.Empty)
      }
    }
    def isDefinedAt(headers: Map[String, String]) = true
  })

  def parseWriteHeader(header: Option[String]): Box[DataProtocolWriteRequestHeader] = {
    for {
      bucket <- Box(header) ?~ "X-Bucket header is missing."
      json <- tryo(Json.parse(bucket))
      r <- json.validate[DataProtocolWriteRequestHeader] match {
        case JsSuccess(r, _) => Full(r)
        case e: JsError => Failure(s"Parsing error: $e")
      }
    } yield {
      r
    }
  }

  def writeRequestIteratee(header: DataProtocolWriteRequestHeader): Iteratee[Array[Byte], FilePart[Box[DataProtocolWriteRequest]]] = {
    Iteratee.fold[Array[Byte], FilePart[Box[DataProtocolWriteRequest]]](filePart(Full(DataProtocolWriteRequest(header, Array.empty)))) {
      (part, data) =>
        part.ref match {
          case Full(request) =>
            filePart(Full(DataProtocolWriteRequest(request.header, Array.concat(request.data, data))))
          case _ =>
            part
        }
    }
  }

  val writeRequestParser = parse.multipartFormData(new PartHandler[FilePart[Box[DataProtocolWriteRequest]]]{
    def apply(headers: Map[String, String]) = {
      parseWriteHeader(headers.get("x-bucket")) match {
        case Full(r) => writeRequestIteratee(r)
        case f: Failure => Done[Array[Byte], FilePart[Box[DataProtocolWriteRequest]]](filePart(f), Input.Empty)
      }
    }
    def isDefinedAt(headers: Map[String, String]) = true
  })
}
