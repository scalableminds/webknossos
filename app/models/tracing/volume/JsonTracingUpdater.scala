package models.tracing.volume

import play.api.libs.json._
import braingames.util.{Fox, FoxImplicits}
import scala.concurrent.Future
import play.api.Logger
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.DBAccessContext

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

  import braingames.geometry.Point3D

  def createUpdate()(implicit ctx: DBAccessContext) = {
    val activeCellId = (value \ "activeCellId").asOpt[Int]
    val editPosition = (value \ "editPosition").as[Point3D]
    val zoomLevel = (value \ "zoomLevel").as[Double]
    TracingUpdate { t =>
      val updated = t.copy(
        activeCellId = activeCellId,
        editPosition = editPosition,
        zoomLevel = zoomLevel)
      VolumeTracingDAO.update(t._id, updated).map(_ => updated)
    }
  }
}
