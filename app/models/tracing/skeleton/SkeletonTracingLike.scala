package models.tracing.skeleton

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalDBAccess}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.xml.{XMLWrites, Xml}
import models.annotation.{AnnotationContent, AnnotationSettings}
import org.apache.commons.io.IOUtils
import oxalis.nml._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import play.api.libs.json._


trait SkeletonTracingLike extends AnnotationContent {
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

  def toDownloadStream(name: String)(implicit ctx: DBAccessContext): Fox[Enumerator[Array[Byte]]] =
    NMLService.toNML(this).map(data => Enumerator.fromStream(IOUtils.toInputStream(data)))

  override def contentData =
    SkeletonTracingLike.skeletonTracingLikeWrites(this)
}

object SkeletonTracingLike extends FoxImplicits {

  implicit object SkeletonTracingLikeXMLWrites extends XMLWrites[SkeletonTracingLike] with GlobalDBAccess {
    def writes(e: SkeletonTracingLike): Fox[scala.xml.Node] = {
      for {
        parameters <- AnnotationContent.writeParametersAsXML(e)
        trees <- e.trees
        treesXml <- Xml.toXML(trees.filterNot(_.nodes.isEmpty))
        branchpoints <- Xml.toXML(trees.flatMap(_.branchPoints).sortBy(-_.timestamp))
        comments <- Xml.toXML(trees.flatMap(_.comments))
      } yield {
        <things>
          <parameters>
            {parameters}
            {e.activeNodeId.map(id => scala.xml.XML.loadString(s"""<activeNode id="$id"/>""")).getOrElse(scala.xml.Null)}
          </parameters>
          {treesXml}
          <branchpoints>
            {branchpoints}
          </branchpoints>
          <comments>
            {comments}
          </comments>
        </things>
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
