import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationDAO
import oxalis.cleanup.CleanUpService
import oxalis.security.WebknossosSilhouette
import play.api._
import play.api.mvc.Results.Ok
import play.api.mvc._
import utils.SQLClient

import scala.concurrent.duration._

object Global extends GlobalSettings with LazyLogging{

  override def onStart(app: Application): Unit = {
    val tokenAuthenticatorService = WebknossosSilhouette.environment.combinedAuthenticatorService.tokenAuthenticatorService

    CleanUpService.register("deletion of expired tokens", tokenAuthenticatorService.dataStoreExpiry) {
      tokenAuthenticatorService.removeExpiredTokens(GlobalAccessContext)
    }

    CleanUpService.register("deletion of old annotations in initializing state", 1 day) {
      AnnotationDAO.deleteOldInitializingAnnotations
    }
  }

  override def onStop(app: Application): Unit = {
    logger.info("Executing Global END")

    logger.info("Closing SQL Database handle")
    SQLClient.db.close()

    super.onStop(app)
  }

  override def onRouteRequest(request: RequestHeader): Option[Handler] = {
    if (request.uri.matches("^(/api/|/data/|/assets/).*$")) {
      super.onRouteRequest(request)
    } else {
      Some(Action {Ok(views.html.main())})
    }
  }

}
