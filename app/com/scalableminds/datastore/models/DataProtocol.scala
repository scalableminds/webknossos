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
import net.liftweb.util.Helpers.tryo

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


/**
 * Binary protocol based on HTTP-Multipart requests.
 *
 * Each HTTP request consists of multiple parts with each part corresponding to one requested bucket.
 * Metainformation such as the bucket's position, size and zoom-level are encoded as JSON and stored in the
 * "X-Bucket" content header of each part.
 *
 * With write requests, the part's body contains the binary data to be written. Read requests must have an empty body.
 */

object DataProtocol {

  /**
   * Wraps each parsed request as a FilePart object to conform to the BodyParser interface
   */

  private def filePart[A](ref: A) = FilePart("", "", None, ref)


  /**
   * Retrieves and decodes the JSON encoded information from the X-Bucket content header
   */

  private def parseReadHeader(header: Option[String]): Box[DataProtocolReadRequest] = {
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


  /**
   * Retrieves the body section of a read request. Only empty bodies are accepted, any unexpected data will be rejected.
   */

  private def readRequestIteratee(request: DataProtocolReadRequest) = {
    Cont[Array[Byte], FilePart[Box[DataProtocolReadRequest]]] {
      case Input.El(Array()) =>
        Done(filePart(Full(request)), Input.Empty)
      case _ =>
        Done(filePart(Failure("Found unexpected data.")), Input.Empty)
    }
  }


  /**
   * Created a BodyParser, that is able to parse read requests.
   * The BodyParser is called on each part of the HTTP-multipart request.
   * The parser accepts all parts of a requests, parsing errors are reported by wrapping the result type inside a Box.
   */

  val readRequestParser = parse.multipartFormData(new PartHandler[FilePart[Box[DataProtocolReadRequest]]]{
    def apply(headers: Map[String, String]) = {
      parseReadHeader(headers.get("x-bucket")) match {
        case Full(r) => readRequestIteratee(r)
        case x => Done[Array[Byte], FilePart[Box[DataProtocolReadRequest]]](filePart(x), Input.Empty)
      }
    }

    // accept all parts
    def isDefinedAt(headers: Map[String, String]) = true
  })


  /**
   * Retrieves and decodes the JSON encoded information from the X-Bucket content header
   */

  private def parseWriteHeader(header: Option[String]): Box[DataProtocolWriteRequestHeader] = {
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


  /**
   * Retrieves the body section of a write request. The Iteratee is called for smaller chunks of the write
   * request's payload and assembles those parts to a single Array.
   */

  private def writeRequestIteratee(header: DataProtocolWriteRequestHeader): Iteratee[Array[Byte], FilePart[Box[DataProtocolWriteRequest]]] = {
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


  /**
   * Created a BodyParser, that is able to parse write requests.
   * The BodyParser is called on each part of the HTTP-multipart request.
   * The parser accepts all parts of a requests, parsing errors are reported by wrapping the result type inside a Box.
   */

  val writeRequestParser = parse.multipartFormData(new PartHandler[FilePart[Box[DataProtocolWriteRequest]]]{
    def apply(headers: Map[String, String]) = {
      parseWriteHeader(headers.get("x-bucket")) match {
        case Full(r) => writeRequestIteratee(r)
        case f: Failure => Done[Array[Byte], FilePart[Box[DataProtocolWriteRequest]]](filePart(f), Input.Empty)
        case Empty => Done[Array[Byte], FilePart[Box[DataProtocolWriteRequest]]](filePart(Empty), Input.Empty)
      }
    }

    // accept all parts
    def isDefinedAt(headers: Map[String, String]) = true
  })
}
