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

  def toAbsolute: UPath

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

  def relativizedIn(potentialParent: UPath): UPath

  def basename: String

  def parent: UPath

  def getScheme: Option[String]

  def startsWith(other: UPath): Boolean

  override def equals(obj: Any): Boolean = obj match {
    case other: UPath => other.toString == this.toString
    case _            => false
  }
}

object UPath {
  def separator: String = "/"
  def schemeSeparator: String = "://"
  def splitKeepLastIfEmpty: Int = -1

  def fromString(literal: String): Box[UPath] = tryo(fromStringUnsafe(literal))

  def fromStringUnsafe(literal: String): UPath = {
    val schemeOpt = if (literal.contains(schemeSeparator)) literal.split(schemeSeparator).headOption else None
    schemeOpt match {
      case None => fromLocalPath(Path.of(literal))
      case Some(scheme) if scheme.contains(PathSchemes.schemeFile) =>
        val nioPath = Path.of(literal.drop(s"$scheme$schemeSeparator".length))
        if (!nioPath.isAbsolute)
          throw new Exception(
            s"Trying to construct relative UPath $nioPath. Must either be absolute or have no scheme.")
        fromLocalPath(nioPath)
      case Some(scheme) =>
        RemoteUPath(scheme,
                    segments = literal
                      .drop(s"$scheme$schemeSeparator".length)
                      .split(separator, splitKeepLastIfEmpty)
                      .toSeq).normalize
    }
  }

  def fromLocalPath(localPath: Path): UPath = LocalUPath(localPath.normalize())

  implicit object jsonFormat extends Format[UPath] {
    override def reads(json: JsValue): JsResult[UPath] =
      for {
        asString <- json.validate[String]
        upath <- fromString(asString) match {
          case Full(parsed) => JsSuccess(parsed)
          case f: Failure   => JsError(f"Invalid UPath: $f")
          case Empty        => JsError(f"Invalid UPath")
        }
      } yield upath

    override def writes(o: UPath): JsValue = JsString(o.toString)
  }

}

private case class LocalUPath(nioPath: Path) extends UPath {
  override def isAbsolute: Boolean = nioPath.isAbsolute

  def toLocalPathUnsafe: Path = nioPath

  override def /(other: String): UPath =
    UPath.fromLocalPath(nioPath.resolve(other))

  override def toString: String = {
    val prefix = if (isRelative) "./" else ""
    prefix + nioPath.toString
  }

  override def toLocalPath: Box[Path] = Full(nioPath)

  override def isRemote: Boolean = false

  override def basename: String = Option(nioPath.getFileName).map(_.toString).getOrElse("")

  override def parent: UPath = Option(nioPath.getParent).map(UPath.fromLocalPath).getOrElse(this)

  override def getScheme: Option[String] = None

  override def toRemoteUriUnsafe: URI = throw new Exception(s"Called toUriUnsafe on LocalUPath $toString")

  override def relativizedIn(potentialAncestor: UPath): UPath =
    potentialAncestor match {
      case LocalUPath(potentialAncestorNioPath) =>
        if (nioPath.toAbsolutePath.startsWith(potentialAncestorNioPath.toAbsolutePath)) {
          LocalUPath(potentialAncestorNioPath.toAbsolutePath.relativize(nioPath.toAbsolutePath))
        } else this
      case _ => this
    }

  private lazy val hashCodeCached = new HashCodeBuilder(19, 29).append(nioPath).toHashCode

  override def hashCode(): Int = hashCodeCached

  override def toAbsolute: UPath = UPath.fromLocalPath(nioPath.toAbsolutePath)

  override def startsWith(other: UPath): Boolean = other match {
    case otherLocal: LocalUPath =>
      this.nioPath.normalize.toAbsolutePath.startsWith(otherLocal.nioPath.normalize.toAbsolutePath)
    case _ => false
  }
}

private case class RemoteUPath(scheme: String, segments: Seq[String]) extends UPath {

  override def isAbsolute: Boolean = true

  def /(other: String): UPath = {
    val otherSegments = other.split(UPath.separator, UPath.splitKeepLastIfEmpty)
    // if last own segment is emptystring, drop it
    val ownSegments = if (segments.lastOption.exists(_.isEmpty)) segments.dropRight(1) else segments
    RemoteUPath(scheme, ownSegments ++ otherSegments).normalize
  }

  def normalize: RemoteUPath = {
    val collectedSegmentsMutable = scala.collection.mutable.ArrayBuffer[String]()
    segments.foreach { segment =>
      if (segment == ".") {
        // do not add it
      } else if (segment == "..") {
        if (collectedSegmentsMutable.length >= 2) { // >= 2 check to prevent deleting “authority” (hostname:port)
          collectedSegmentsMutable.remove(collectedSegmentsMutable.length - 1)
        }
      } else {
        collectedSegmentsMutable.addOne(segment)
      }
    }
    RemoteUPath(scheme, collectedSegmentsMutable.toSeq)
  }

  override def toLocalPathUnsafe: Path = throw new Exception(s"Called toLocalPathUnsafe on RemotePath $this")

  override def toString: String = scheme + UPath.schemeSeparator + segments.mkString(UPath.separator)

  override def toLocalPath: Box[Path] = Failure(s"Accessed toLocalPath on RemotePath $this")

  override def isRemote: Boolean = true

  override def basename: String = segments.findLast(_.nonEmpty).getOrElse("")

  override def parent: UPath =
    // < 2 check to avoid deleting “authority” (hostname:port)
    if (segments.length < 2) this else RemoteUPath(scheme, segments.dropRight(1))

  override def getScheme: Option[String] = Some(scheme)

  override def toRemoteUriUnsafe: URI = new URI(toString)

  override def relativizedIn(potentialAncestor: UPath): UPath = this

  private lazy val hashCodeCached = new HashCodeBuilder(19, 29).append(scheme).append(segments).toHashCode

  override def hashCode(): Int = hashCodeCached

  override def toAbsolute: UPath = this

  def startsWith(other: UPath): Boolean = other match {
    case otherRemote: RemoteUPath =>
      this.normalize.toString.startsWith(otherRemote.normalize.toString)
    case _ => false
  }

}
