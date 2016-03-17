package models.tracing.volume

import com.scalableminds.util.geometry.Vector3D
import play.api.libs.json._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import scala.concurrent.Future
import play.api.Logger
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.reactivemongo.DBAccessContext
import models.binary.UserDataLayerDAO

object TracingUpdater {

  implicit object TracingUpdateReads extends Reads[TracingUpdater] {
    def reads(js: JsValue) = {
      val value = (js \ "value").as[JsObject]
      JsSuccess((js \ "action").as[String] match {
        case "updateTracing" => UpdateTracing(value)
      })
    }
  }

  def createUpdateFromJson(js: JsValue)(implicit ctx: DBAccessContext): Option[TracingUpdate] = {
    try {
      val updater = js.as[TracingUpdater]
      Some(updater.createUpdate())
    } catch {
      case e: java.lang.RuntimeException =>
        Logger.error("Invalid json: " + e)
        None
    }
  }
}

case class TracingUpdate(update: VolumeTracing => Fox[VolumeTracing])

trait TracingUpdater extends FoxImplicits {
  def createUpdate()(implicit ctx: DBAccessContext): TracingUpdate
}

case class UpdateTracing(value: JsObject) extends TracingUpdater {

  import com.scalableminds.util.geometry.Point3D

  def createUpdate()(implicit ctx: DBAccessContext) = {
    val activeCellId = (value \ "activeCell").asOpt[Int]
    val nextSegmentationId = (value \ "nextCell").asOpt[Int]
    val editPosition = (value \ "editPosition").asOpt[Point3D]
    val editRotation = (value \ "editRotation").asOpt[Vector3D]
    val zoomLevel = (value \ "zoomLevel").asOpt[Double]
    TracingUpdate { t =>
      val updated = t.copy(
        activeCellId = activeCellId,
        editPosition = editPosition getOrElse t.editPosition,
        editRotation = editRotation getOrElse t.editRotation,
        zoomLevel = zoomLevel getOrElse t.zoomLevel)
      UserDataLayerDAO.updateNextSegmentationId(t.userDataLayerName, nextSegmentationId)
      VolumeTracingDAO.update(t._id, updated).map(_ => updated)
    }
  }
}
