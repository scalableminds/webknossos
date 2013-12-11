package models.tracing

import models.annotation.AnnotationSettings
import models.basics.SecuredBaseDAO
import play.api.libs.json.Json
import braingames.util.{Fox, FoxImplicits}
import play.modules.reactivemongo.json.BSONFormats._
import braingames.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.core.commands.LastError

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 02.06.13
 * Time: 11:36
 */
trait CommonTracingService extends FoxImplicits {
  def dao: SecuredBaseDAO[_]

  def updateSettings(settings: AnnotationSettings, tracingId: String)(implicit ctx: DBAccessContext): Unit = {
    dao.withValidId(tracingId) {
      id =>
        dao.collectionUpdate(
          Json.obj("_id" -> id),
          Json.obj("$set" -> Json.obj("settings" -> settings)),
          upsert = false,
          multi = false
        )
    }
  }

}
