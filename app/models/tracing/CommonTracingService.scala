package models.tracing

import com.scalableminds.util.geometry.{Point3D, BoundingBox}
import models.annotation.AnnotationSettings
import models.basics.SecuredBaseDAO
import play.api.libs.json.Json
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.modules.reactivemongo.json.BSONFormats._
import com.scalableminds.util.reactivemongo.DBAccessContext


trait CommonTracingService extends FoxImplicits {
  def dao: SecuredBaseDAO[_ <: CommonTracing]



  def updateEditPosition(editPosition: Point3D, tracingId: String)(implicit ctx: DBAccessContext): Fox[Boolean] = {
    dao.withValidId(tracingId) {
      id =>
        dao.update(
          Json.obj("_id" -> id),
          Json.obj("$set" -> Json.obj(
            "editPosition" -> editPosition)),
          multi = false,
          upsert = false
        ).map(_.ok)
    }
  }

  def updateSettings(
    dataSetName: String,
    boundingBox: Option[BoundingBox],
    settings: AnnotationSettings,
    tracingId: String)(implicit ctx: DBAccessContext): Fox[Boolean] = {

    dao.withValidId(tracingId) {
      id =>
        dao.update(
          Json.obj("_id" -> id),
          Json.obj("$set" -> Json.obj(
            "settings" -> settings,
            "boundingBox" -> boundingBox,
            "dataSetName" -> dataSetName)),
          upsert = false,
          multi = false
        ).map(_.ok)
    }
  }

  def updateSettings(
    settings: AnnotationSettings,
    tracingId: String)(implicit ctx: DBAccessContext): Fox[Boolean] = {

    dao.withValidId(tracingId) {
      id =>
        dao.update(
          Json.obj("_id" -> id),
          Json.obj("$set" -> Json.obj(
            "settings" -> settings)),
          upsert = false,
          multi = false
        ).map(_.ok)
    }
  }
}
