package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Box, Empty, Failure, Full}
import com.scalableminds.util.tools.Box.tryo
import org.apache.commons.lang3.builder.HashCodeBuilder
import play.api.libs.json.{Format, JsError, JsResult, JsString, JsSuccess, JsValue}

import java.net.URI
import java.nio.file.Path

trait UPath {
  def toRemoteUri: Box[URI]

  def toZipEntryUPath: Box[ZipEntryUPath]

  def /(other: String): UPath

  def /(other: ObjectId): UPath =
    this / other.toString

  // TODO consider allowing this only in well-defined cases
  def /(other: UPath): UPath =
    other match {
      case ZipEntryUPath(outerPath, innerPath) => ZipEntryUPath(this / outerPath, innerPath)
      case _                                   => this / other.toString
    }

  def toAbsolute: UPath

  def toReal: Box[UPath]

  def toLocalPath: Box[Path]

  def isAbsolute: Boolean

  def isRelative: Boolean = !isAbsolute

  def isRemote: Boolean

  def isLocal: Boolean = !isRemote

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

case class ZipEntryUPath(outerPath: UPath, innerPath: String) extends UPath {
  override def toString: String =
    if (innerPath.isEmpty) s"$outerPath${ZipEntryUPath.separatorRoot}"
    else s"$outerPath${ZipEntryUPath.separatorWithPath}$innerPath"
  override def getScheme: Option[String] = outerPath.getScheme
  override def isAbsolute: Boolean = outerPath.isAbsolute
  override def isRemote: Boolean = outerPath.isRemote
  override def toLocalPath: Box[Path] = Failure(s"ZipEntryUPath cannot be accessed as a local path: $this")
  override def toRemoteUri: Box[URI] = outerPath.toRemoteUri
  override def toZipEntryUPath: Box[ZipEntryUPath] = Full(this)
  override def toAbsolute: UPath = ZipEntryUPath(outerPath.toAbsolute, innerPath)
  override def toReal: Box[UPath] = outerPath.toReal.map(ZipEntryUPath(_, innerPath))
  override def relativizedIn(p: UPath): UPath = this
  override def basename: String = innerPath.split("/").filter(_.nonEmpty).lastOption.getOrElse("")
  override def parent: UPath = {
    val parts = innerPath.split("/").filter(_.nonEmpty)
    if (parts.length <= 1) outerPath
    else ZipEntryUPath(outerPath, parts.dropRight(1).mkString("/"))
  }
  override def /(other: String): UPath =
    ZipEntryUPath(outerPath, s"$innerPath/$other".replaceAll("//+", "/").stripPrefix("/"))
  override def startsWith(other: UPath): Boolean = other match {
    case ZipEntryUPath(op, ip) => outerPath == op && (ip.isEmpty || innerPath == ip || innerPath.startsWith(ip + "/"))
    case _                     => outerPath.startsWith(other)
  }
  private lazy val hashCodeCached = new HashCodeBuilder(23, 37).append(outerPath).append(innerPath).toHashCode
  override def hashCode(): Int = hashCodeCached
}

object ZipEntryUPath {
  val separatorWithPath: String = "|zip:"
  val separatorRoot: String = "|zip"
  val relevantFileExtensions: Seq[String] = Seq(".zip", ".ozx")
}

object UPath {
  def separator: String = "/"
  def schemeSeparator: String = "://"
  def splitKeepLastIfEmpty: Int = -1

  def fromString(literal: String): Box[UPath] = tryo(fromStringUnsafe(literal))

  // Warning: throws! Prefer fromString (returns Box) for user-supplied input
  def fromStringUnsafe(literal: String): UPath = {
    // TODO simplify or extract
    // Detect "|zip:path" (entry) or "|zip" at end (root reference, inner path = "").
    // Per spec, two or more leading slashes in the inner path are an error.
    val withColonIdx = literal.indexOf(ZipEntryUPath.separatorWithPath)
    val rootRefIdx =
      if (literal.endsWith(ZipEntryUPath.separatorRoot) && withColonIdx < 0)
        literal.length - ZipEntryUPath.separatorRoot.length
      else -1
    if (withColonIdx >= 0 || rootRefIdx >= 0) {
      val (outerLiteral, innerPath) =
        if (withColonIdx >= 0)
          (literal.substring(0, withColonIdx), literal.substring(withColonIdx + ZipEntryUPath.separatorWithPath.length))
        else
          (literal.substring(0, rootRefIdx), "")
      if (innerPath.startsWith("//"))
        throw new Exception(
          s"Invalid zip inner path '$innerPath': multiple leading slashes are not allowed (per zip: URL spec)"
        )
      ZipEntryUPath(fromStringUnsafe(outerLiteral), innerPath.stripPrefix("/"))
    } else {
      val schemeOpt = if (literal.contains(schemeSeparator)) literal.split(schemeSeparator).headOption else None
      schemeOpt match {
        case None                                                    => fromLocalPath(Path.of(literal))
        case Some(scheme) if scheme.contains(PathSchemes.schemeFile) =>
          val nioPath = Path.of(literal.drop(s"$scheme$schemeSeparator".length))
          if (!nioPath.isAbsolute)
            throw new Exception(
              s"Trying to construct relative UPath $nioPath. Must either be absolute or have no scheme."
            )
          fromLocalPath(nioPath)
        case Some(scheme) =>
          RemoteUPath(
            scheme,
            segments = literal.drop(s"$scheme$schemeSeparator".length).split(separator, splitKeepLastIfEmpty).toSeq
          ).normalize
      }
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
          case Empty        => JsError("Invalid UPath")
        }
      } yield upath

    override def writes(o: UPath): JsValue = JsString(o.toString)
  }

}

private case class LocalUPath(nioPath: Path) extends UPath {
  override def isAbsolute: Boolean = nioPath.isAbsolute

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

  override def toRemoteUri: Box[URI] = Failure(s"Called toRemoteUri on LocalUPath $toString")

  override def toZipEntryUPath: Box[ZipEntryUPath] = Failure(s"Called toZipEntryUPath on LocalUPath $toString")

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

  override def toReal: Box[UPath] = tryo(nioPath.toRealPath()).map(UPath.fromLocalPath)

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

  override def toString: String = scheme + UPath.schemeSeparator + segments.mkString(UPath.separator)

  override def toLocalPath: Box[Path] = Failure(s"Accessed toLocalPath on RemotePath $this")

  override def isRemote: Boolean = true

  override def basename: String = segments.findLast(_.nonEmpty).getOrElse("")

  override def parent: RemoteUPath =
    // < 2 check to avoid deleting “authority” (hostname:port)
    if (segments.length < 2) this else RemoteUPath(scheme, segments.dropRight(1))

  override def getScheme: Option[String] = Some(scheme)

  override def toRemoteUri: Box[URI] = tryo(new URI(toString))

  override def toZipEntryUPath: Box[ZipEntryUPath] = Failure(s"Called toZipEntryUPath on RemotePath $toString")

  override def relativizedIn(potentialAncestor: UPath): UPath = this

  private lazy val hashCodeCached = new HashCodeBuilder(19, 29).append(scheme).append(segments).toHashCode

  override def hashCode(): Int = hashCodeCached

  override def toAbsolute: UPath = this

  override def toReal: Box[UPath] = Full(this)

  def startsWith(other: UPath): Boolean = other match {
    case otherRemote: RemoteUPath =>
      val thisNormalized = this.normalize
      val otherNormalized = otherRemote.normalize
      val otherSegments =
        if (otherNormalized.segments.lastOption.contains("")) otherNormalized.segments.dropRight(1)
        else otherNormalized.segments
      thisNormalized.scheme == otherNormalized.scheme && thisNormalized.segments.startsWith(otherSegments)
    case _ => false
  }

}
