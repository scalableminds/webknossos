package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.tools.{Box, Empty, Failure, Full}
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import play.api.libs.json.{Format, JsError, JsResult, JsString, JsSuccess, JsValue}

import java.net.URI
import java.nio.file.Path

trait UPath {
  def toRemoteUri: Box[URI] = tryo(toRemoteUriUnsafe)

  def toRemoteUriUnsafe: URI

  def /(other: String): UPath

  def /(other: UPath): UPath =
    this / other.toString

  def toAbsolute: Box[UPath] =
    if (isAbsolute)
      Full(this)
    else
      UPath.fromString(toLocalPathUnsafe.toAbsolutePath.toString)

  def toLocalPath: Box[Path]

  def isAbsolute: Boolean

  def isRelative: Boolean = !isAbsolute

  def isRemote: Boolean

  def isLocal: Boolean = !isRemote

  def toLocalPathUnsafe: Path

  def resolvedIn(parentIfRelative: UPath): UPath =
    if (isRelative) {
      parentIfRelative / this
    } else this

  def basename: String

  def parent: UPath

  def getScheme: Option[String]

  override def equals(obj: Any): Boolean = obj match {
    case other: UPath => other.toString == this.toString
    case _            => false
  }
}

object UPath {
  def separator: Char = '/'

  def fromString(literal: String): Box[UPath] = tryo(fromStringUnsafe(literal))

  def fromStringUnsafe(literal: String): UPath = {
    // TODO assert at least one segment?
    val schemeOpt = literal.split("://").headOption
    schemeOpt match {
      case None => new LocalUPath(Path.of(literal))
      case Some(scheme) if scheme.contains(PathSchemes.schemeFile) =>
        new LocalUPath(Path.of(literal.drop(s"$scheme://".length)))
      case Some(scheme) =>
        new RemotePath(scheme, segments = literal.drop(s"$scheme://".length).split(separator.toString).toSeq)
    }
  }

  def fromLocalPath(localPath: Path): UPath = new LocalUPath(localPath)

  implicit object jsonFormat extends Format[UPath] {
    override def reads(json: JsValue): JsResult[UPath] =
      for {
        asString <- json.validate[String]
        uPath <- fromString(asString) match {
          case Full(parsed) => JsSuccess(parsed)
          case f: Failure   => JsError(f"Invalid UPath: $f")
          case Empty        => JsError(f"Invalid UPath")
        }
      } yield uPath

    override def writes(o: UPath): JsValue = JsString(o.toString)
  }

}

class LocalUPath(nioPath: Path) extends UPath {
  override def isAbsolute: Boolean = nioPath.isAbsolute

  def toLocalPathUnsafe: Path = nioPath

  override def /(other: String): UPath =
    new LocalUPath(nioPath.resolve(other))

  override def toString: String = nioPath.toString

  override def toLocalPath: Box[Path] = Full(nioPath)

  override def isRemote: Boolean = false

  override def basename: String = nioPath.getFileName.toString

  override def parent: UPath = new LocalUPath(nioPath.getParent)

  override def getScheme: Option[String] = None

  override def toRemoteUriUnsafe: URI = throw new Exception(s"Called toUriUnsafe on LocalUPath $toString")
}

class RemotePath(scheme: String, segments: Seq[String]) extends UPath {
  override def isAbsolute: Boolean = true

  def /(other: String): UPath = {
    val newSegments = other.split(UPath.separator.toString)
    if (newSegments.isEmpty) this
    else
      new RemotePath(scheme, segments ++ newSegments)
  }

  override def toLocalPathUnsafe: Path = throw new Exception(s"Called toLocalPathUnsafe on RemotePath $this")

  override def toString: String = scheme + "://" + segments.mkString(UPath.separator.toString)

  override def toLocalPath: Box[Path] = Failure(s"Accessed toLocalPath on RemotePath $this")

  override def isRemote: Boolean = true

  override def basename: String = segments.last

  override def parent: UPath =
    // need to have at least one segment (assumed to be the authority)
    if (segments.length < 2) this else new RemotePath(scheme, segments.dropRight(1))

  override def getScheme: Option[String] = Some(scheme)

  override def toRemoteUriUnsafe: URI = new URI(toString)
}
