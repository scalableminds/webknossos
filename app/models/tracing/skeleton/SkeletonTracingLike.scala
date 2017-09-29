package models.tracing.skeleton

import javax.xml.stream.XMLStreamWriter

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalDBAccess}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.xml.{XMLWrites, Xml}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.{AnnotationContent, AnnotationLike, AnnotationSettings}
import models.tracing.skeleton.SkeletonTracingLike.SkeletonTracingLikeXMLWrites
import org.apache.commons.io.IOUtils
import oxalis.nml._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import play.api.libs.json._


trait SkeletonTracingLike extends AnnotationContent with LazyLogging {
  type Self <: SkeletonTracingLike

  def self = this.asInstanceOf[Self]

  def settings: AnnotationSettings

  def dataSetName: String

  def trees: Fox[List[TreeLike]]

  def activeNodeId: Option[Int]

  def timestamp: Long

  def editPosition: Point3D

  def editRotation: Vector3D

  def zoomLevel: Double

  def boundingBox: Option[BoundingBox]

  def allowAllModes: Self

  def contentType = SkeletonTracing.contentType

  def downloadFileExtension = ".nml"

  def stats: Option[SkeletonTracingStatistics]

  def toDownloadStream(name: String, a: AnnotationLike)(implicit ctx: DBAccessContext): Fox[Enumerator[Array[Byte]]] = {
    logger.trace("Download stream for skeleton content requested")
    Fox.successful(Enumerator.outputStream { os =>
      NMLService.toNML(this, a, os)(SkeletonTracingLikeXMLWrites).map(_ => os.close())
    })
  }

  override def contentData =
    SkeletonTracingLike.skeletonTracingLikeWrites(this)
}

object SkeletonTracingLike extends FoxImplicits with LazyLogging {

  implicit object SkeletonTracingLikeXMLWrites extends XMLWrites[(SkeletonTracingLike, AnnotationLike)] with GlobalDBAccess {
    def writes(e: (SkeletonTracingLike, AnnotationLike))(implicit writer: XMLStreamWriter): Fox[Boolean] = {
      Xml.withinElement("things") {
        for {
          _ <- Xml.withinElement("parameters")(AnnotationContent.writeParametersAsXML(e._1, e._2, writer))
          trees <- e._1.trees
          _ <- Xml.toXML(trees.filterNot(_.nodes.isEmpty))
          _ <- Xml.withinElement("branchpoints")(Xml.toXML(trees.flatMap(_.branchPoints).sortBy(-_.timestamp)))
          _ <- Xml.withinElement("comments")(Xml.toXML(trees.flatMap(_.comments)))
        } yield true
      }
    }
  }

  def skeletonTracingLikeWrites(t: SkeletonTracingLike) =
    for {
      trees <- t.trees
    } yield {
      Json.obj(
        "activeNode" -> t.activeNodeId,
        "trees" -> trees,
        "zoomLevel" -> t.zoomLevel
      )
    }
}
