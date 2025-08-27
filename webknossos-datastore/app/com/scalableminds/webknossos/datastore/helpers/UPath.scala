package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.tools.{Box, Empty, Failure, Full}
import com.scalableminds.util.tools.Box.tryo
import org.apache.commons.lang3.builder.HashCodeBuilder
import play.api.libs.json.{Format, JsError, JsResult, JsString, JsSuccess, JsValue}

import java.net.URI
import java.nio.file.Path

trait UPath {
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
  private def schemeSeparator: String = "://"
  def splitKeepLastIfEmpty: Int = -1

  def fromString(literal: String): Box[UPath] = tryo(fromStringUnsafe(literal))

  def fromStringUnsafe(literal: String): UPath = {
    val schemeOpt = if (literal.contains(schemeSeparator)) literal.split(schemeSeparator).headOption else None
    schemeOpt match {
      case None => fromLocalPath(Path.of(literal))
      case Some(scheme) if scheme.contains(PathSchemes.schemeFile) =>
        val nioPath = Path.of(literal.drop(s"$scheme://".length))
        if (!nioPath.isAbsolute)
          throw new Exception(
            s"Trying to construct relative UPath $nioPath. Must either be absolute or have no scheme.")
        fromLocalPath(nioPath)
      case Some(scheme) =>
        new RemotePath(
          scheme,
          segments = literal.drop(s"$scheme://".length).split(separator.toString, splitKeepLastIfEmpty).toSeq).normalize
    }
  }

  def fromLocalPath(localPath: Path): UPath = new LocalUPath(localPath.normalize())

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

private class LocalUPath(nioPath: Path) extends UPath {
  override def isAbsolute: Boolean = nioPath.isAbsolute

  def toLocalPathUnsafe: Path = nioPath

  override def /(other: String): UPath =
    UPath.fromLocalPath(nioPath.resolve(other))

  override def toString: String = {
    val prefix = if (isRelative) "./" else PathSchemes.schemeFile + "://"
    prefix + nioPath.toString
  }

  override def toLocalPath: Box[Path] = Full(nioPath)

  override def isRemote: Boolean = false

  override def basename: String = nioPath.getFileName.toString

  override def parent: UPath = UPath.fromLocalPath(nioPath.getParent)

  override def getScheme: Option[String] = None

  override def toRemoteUriUnsafe: URI = throw new Exception(s"Called toUriUnsafe on LocalUPath $toString")

  override def hashCode(): Int =
    new HashCodeBuilder(19, 29).append(nioPath).toHashCode
}

private class RemotePath(scheme: String, segments: Seq[String]) extends UPath {

  override def isAbsolute: Boolean = true

  def /(other: String): UPath = {
    val otherSegments = other.split(UPath.separator.toString, UPath.splitKeepLastIfEmpty)
    // if last own segment is emptystring, drop it
    val ownSegments = if (segments.lastOption.exists(_.isEmpty)) segments.dropRight(1) else segments
    new RemotePath(scheme, ownSegments ++ otherSegments).normalize
  }

  def normalize: UPath = {
    val collectedSegmentsMutable = scala.collection.mutable.ArrayBuffer[String]()
    segments.foreach { segment =>
      if (segment == ".") {
        // do not add it
      } else if (segment == "..") {
        if (collectedSegmentsMutable.length >= 2) {
          collectedSegmentsMutable.remove(collectedSegmentsMutable.length - 1)
        }
      } else {
        collectedSegmentsMutable.addOne(segment)
      }
    }
    new RemotePath(scheme, collectedSegmentsMutable.toSeq)
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

  override def hashCode(): Int =
    new HashCodeBuilder(19, 29).append(scheme).append(segments).toHashCode
}
