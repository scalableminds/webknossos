package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.tools.{Box, Empty, Failure, Full}
import com.scalableminds.util.tools.Box.tryo
import play.api.libs.json.{Format, JsError, JsResult, JsString, JsSuccess, JsValue}

import java.net.URI
import java.nio.file.Path

class UriPath(uri: URI) {

  def toUri: URI =
    uri

  def /(key: String): UriPath =
    if (uri.toString.endsWith("/")) {
      new UriPath(uri.resolve(key))
    } else {
      new UriPath(new URI(s"${uri.toString}/").resolve(key))
    }

  def /(other: UriPath): UriPath =
    if (other.isRelative)
      // TODO test, clean up
      new UriPath(this.uri.resolve(other.toUri.toString))
    else other

  def toAbsolute: Box[UriPath] =
    if (uri.getScheme == null) {
      // assume local, either already absolute or relative
      UriPath.fromString(s"file://${Path.of(uri.toString).toAbsolutePath.toString}")
    } else {
      // assume either remote, or local with file://, which must already be absolute
      Full(this)
    }

  def isRelative: Boolean = scheme.isEmpty && !uri.getPath.startsWith("/")

  private def scheme: Option[String] = Option(uri.getScheme)

  def isRemote: Boolean = scheme.exists(PathSchemes.isRemoteScheme)

  // TODO throws. should return Box instead.
  def toLocalPath: Path = {
    if (isRemote) {
      throw new Exception(
        "Trying to open non-local hdf5 file. Hdf5 files are only supported on the datastore-local file system.")
    }
    if (scheme.isDefined) {
      Path.of(uri.toString).normalize()
    } else {
      Path.of(uri).normalize()
    }
  }

  def resolvedIn(parentIfRelative: UriPath): UriPath =
    if (isRelative) {
      parentIfRelative / this
    } else this

  override def toString: String = uri.toString

  // TODO json format

}

object UriPath {
  def fromString(literal: String): Box[UriPath] = tryo(new URI(literal)).map(new UriPath(_))

  def fromLocalPath(localPath: Path): UriPath = new UriPath(localPath.toUri)

  implicit object jsonFormat extends Format[UriPath] {
    override def reads(json: JsValue): JsResult[UriPath] =
      for {
        asString <- json.validate[String]
        uriPath <- fromString(asString) match {
          case Full(parsed) => JsSuccess(parsed)
          case f: Failure   => JsError(f"Invalid UriPath: $f")
          case Empty        => JsError(f"Invalid UriPath")
        }
      } yield uriPath

    override def writes(o: UriPath): JsValue = JsString(o.toString)
  }

}
