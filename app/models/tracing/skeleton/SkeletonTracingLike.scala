package models.tracing.skeleton

import models.tracing.skeleton.temporary.TemporarySkeletonTracing
import oxalis.nml._
import oxalis.nml.utils._
import play.api.libs.iteratee.Enumerator
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import play.api.libs.json._
import play.api.libs.functional.syntax._
import com.scalableminds.util.xml.XMLWrites
import models.binary.DataSetDAO
import com.scalableminds.util.xml.Xml
import models.annotation.{AnnotationContent, AnnotationSettings, AnnotationType, ContentReference}
import play.api.i18n.Messages
import org.apache.commons.io.IOUtils
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future

import models.annotation.AnnotationType._
import scala.Some

import oxalis.nml.NML
import models.annotation.AnnotationType.AnnotationType
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalDBAccess}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.Full
import java.io.InputStream

import controllers.NMLIOController

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

  def roundTripTime: Double

  def bandwidth: Double

  def boundingBox: Option[BoundingBox]

  def allowAllModes: Self

  def contentType = SkeletonTracing.contentType

  def downloadFileExtension = ".nml"

  def stats: Option[SkeletonTracingStatistics]

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
        branchpoints <- Xml.toXML(trees.flatMap(_.branchPoints).sortBy(-_.timestamp))
        comments <- Xml.toXML(trees.flatMap(_.comments))
      } yield {
        <things>
          <parameters>
            <experiment name={dataSet.name}/>
            <scale x={dataSource.scale.x.toString} y={dataSource.scale.y.toString} z={dataSource.scale.z.toString}/>
            <offset x="0" y="0" z="0"/>
            <time ms={e.timestamp.toString}/>
            {e.activeNodeId.map(id => scala.xml.XML.loadString(s"""<activeNode id="$id"/>""")).getOrElse(scala.xml.Null)}
            <editPosition x={e.editPosition.x.toString} y={e.editPosition.y.toString} z={e.editPosition.z.toString}/>
            <connection roundTripTime={e.roundTripTime.toString} bandwidth={e.bandwidth.toString}/>
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
        "trees" -> trees,
        "zoomLevel" -> t.zoomLevel
      )
    }
}
