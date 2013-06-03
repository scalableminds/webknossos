package models.tracing.volume

import oxalis.nml.{Comment, BranchPoint}
import braingames.geometry.{Point3D, Scale}
import models.annotation.{AnnotationContentDAO, AnnotationContent, AnnotationSettings}
import org.bson.types.ObjectId
import models.basics.{BasicDAO, DAOCaseClass}
import models.tracing.skeleton.SkeletonTracingLike
import models.tracing.CommonTracingDAO
import braingames.binary.models.DataSet
import java.io.InputStream
import play.api.libs.json.{JsValue, JsObject}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 02.06.13
 * Time: 11:23
 */
case class VolumeTracing(
  dataSetName: String,
  timestamp: Long,
  scale: Scale,
  editPosition: Point3D,
  settings: AnnotationSettings = AnnotationSettings.default,
  _id: ObjectId = new ObjectId)
  extends DAOCaseClass[VolumeTracing] with AnnotationContent {

  def id = _id.toString

  type Self = VolumeTracing

  def dao = VolumeTracing

  def updateFromJson(jsUpdates: Seq[JsValue]) = ???

  def annotationInformation: JsObject = ???

  def copyDeepAndInsert = ???

  def mergeWith(source: AnnotationContent) = ???

  def clearTracingData() = ???

  def contentType: String = ???

  def createTracingInformation(): JsObject = ???

  def toDownloadStream: InputStream = ???

  def downloadFileExtension: String = ???
}

object VolumeTracing extends BasicDAO[VolumeTracing]("volumes") with AnnotationContentDAO with CommonTracingDAO{
  type AType = VolumeTracing

  def createForDataSet(dataSet: DataSet) =
    //TODO
    ???

}
