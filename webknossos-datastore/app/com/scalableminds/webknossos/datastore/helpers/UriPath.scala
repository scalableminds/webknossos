package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.tools.{Box, Full}
import com.scalableminds.util.tools.Box.tryo

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

  def toAbsolute: Box[UriPath] =
    if (uri.getScheme == null) {
      // assume local, either already absolute or relative
      UriPath.fromString(s"file://${Path.of(uri.toString).toAbsolutePath.toString}")
    } else {
      // assume either remote, or local with file://, which must already be absolute
      Full(this)
    }

  def isRelative: Boolean =

  private def scheme: Option[String] = Option(uri.getScheme)

  def isRemote: Boolean = scheme.exists(PathSchemes.isRemoteScheme)

  // TODO throws. should return Box instead.
  def toLocalPath: Path = {
    if (isRemote) {
      throw new Exception(
        "Trying to open non-local hdf5 file. Hdf5 files are only supported on the datastore-local file system.")
    }
    if (scheme.isDefined) {
      Path.of(uri.toString)
    } else {
      Path.of(uri)
    }
  }

  override def toString: String = uri.toString

  // TODO json format

  // TODO to and from SQL

}

object UriPath {
  def fromString(literal: String): Box[UriPath] = tryo(new URI(literal)).map(new UriPath(_))
}
