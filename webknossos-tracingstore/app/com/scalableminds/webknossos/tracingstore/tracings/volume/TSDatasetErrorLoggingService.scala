package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.webknossos.datastore.services.DatasetErrorLoggingService
import org.apache.pekko.actor.ActorSystem
import play.api.inject.ApplicationLifecycle

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class TSDatasetErrorLoggingService @Inject() (
    val lifecycle: ApplicationLifecycle,
    val actorSystem: ActorSystem
)(implicit val ec: ExecutionContext)
    extends DatasetErrorLoggingService {
  protected val applicationHealthService: Option[Nothing] = None
}
