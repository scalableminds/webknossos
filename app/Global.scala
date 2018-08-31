import com.newrelic.api.agent.NewRelic
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.typesafe.scalalogging.LazyLogging
import controllers.InitialDataService
import models.annotation.AnnotationDAO
import net.liftweb.common.{Failure, Full}
import oxalis.cleanup.CleanUpService
import oxalis.security.WebknossosSilhouette
import play.api.libs.concurrent.Execution.Implicits._
import play.api._
import play.api.mvc.Results.Ok
import play.api.mvc._
import utils.{SQLClient, WkConf}

import scala.concurrent.Future
import sys.process._
import scala.concurrent.duration._

object Global extends GlobalSettings with LazyLogging {

  override def onRouteRequest(request: RequestHeader): Option[Handler] = {
    if (request.uri.matches("^(/api/|/data/|/assets/).*$")) {
      super.onRouteRequest(request)
    } else {
      Some(Action {Ok(views.html.main())})
    }
  }

}
