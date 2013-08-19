package models.tracing

import models.annotation.AnnotationSettings
import com.mongodb.casbah.commons.MongoDBObject
import models.basics.BasicDAO

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 02.06.13
 * Time: 11:36
 */
trait CommonTracingDAO {
  this: BasicDAO[_] =>

  def updateSettings(settings: AnnotationSettings, tracingId: String) {
    withValidId(tracingId) {
      id =>
        Some(update(
          MongoDBObject("_id" -> id),
          MongoDBObject("settings" -> settings),
          false,
          false
        ))
    }
  }

}
