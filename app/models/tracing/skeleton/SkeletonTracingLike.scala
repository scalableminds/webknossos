package models.tracing.skeleton

import models.tracing.skeleton.temporary.TemporarySkeletonTracing
import oxalis.nml._
import oxalis.nml.utils._
import com.scalableminds.util.geometry.Scale
import com.scalableminds.util.geometry.{Point3D, BoundingBox}
import play.api.libs.iteratee.Enumerator
import play.api.libs.json._
import play.api.libs.functional.syntax._
import com.scalableminds.util.xml.XMLWrites
import models.binary.DataSetDAO
import com.scalableminds.util.xml.Xml
import models.annotation.{AnnotationType, ContentReference, AnnotationContent, AnnotationSettings}
import play.api.i18n.Messages
import controllers.admin.NMLIO
import org.apache.commons.io.IOUtils
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future

import models.annotation.AnnotationType._
import scala.Some
import oxalis.nml.NML
import models.annotation.AnnotationType.AnnotationType
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalDBAccess}
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import net.liftweb.common.Full
import java.io.InputStream

trait SkeletonTracingLike extends AnnotationContent {
  type Self <: SkeletonTracingLike

  def self = this.asInstanceOf[Self]

  def settings: AnnotationSettings

  def dataSetName: String

  def trees: Fox[List[TreeLike]]

  def activeNodeId: Option[Int]

  def timestamp: Long

  def branchPoints: List[BranchPoint]

  def comments: List[Comment]

  def editPosition: Point3D

  def zoomLevel: Double

  def boundingBox: Option[BoundingBox]

  def allowAllModes: Self

  def contentType = SkeletonTracing.contentType

  def downloadFileExtension = ".nml"

  def toDownloadStream(implicit ctx: DBAccessContext): Fox[Enumerator[Array[Byte]]] =
    NMLService.toNML(this).map(data => Enumerator.fromStream(IOUtils.toInputStream(data)))

  override def contentData =
    SkeletonTracingLike.skeletonTracingLikeWrites(this)
}

object SkeletonTracingLike extends FoxImplicits {

  implicit object SkeletonTracingLikeXMLWrites extends XMLWrites[SkeletonTracingLike] with GlobalDBAccess {
    def writes(e: SkeletonTracingLike): Fox[scala.xml.Node] = {
      for {
        dataSet <- DataSetDAO.findOneBySourceName(e.dataSetName)
        dataSource <- dataSet.dataSource.toFox
        trees <- e.trees
        treesXml <- Xml.toXML(trees.filterNot(_.nodes.isEmpty))
        branchpoints <- Xml.toXML(e.branchPoints)
        comments <- Xml.toXML(e.comments)
      } yield {
        <things>
          <parameters>
            <experiment name={dataSet.name}/>
            <scale x={dataSource.scale.x.toString} y={dataSource.scale.y.toString} z={dataSource.scale.z.toString}/>
            <offset x="0" y="0" z="0"/>
            <time ms={e.timestamp.toString}/>
            {e.activeNodeId.map(id => scala.xml.XML.loadString(s"""<activeNode id="$id"/>""")).getOrElse(scala.xml.Null)}
            <editPosition x={e.editPosition.x.toString} y={e.editPosition.y.toString} z={e.editPosition.z.toString}/>
            <zoomLevel zoom={e.zoomLevel.toString}/>
          </parameters>{treesXml}<branchpoints>
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
        "branchPoints" -> t.branchPoints,
        "comments" -> t.comments,
        "trees" -> trees,
        "zoomLevel" -> t.zoomLevel
      )
    }
}
