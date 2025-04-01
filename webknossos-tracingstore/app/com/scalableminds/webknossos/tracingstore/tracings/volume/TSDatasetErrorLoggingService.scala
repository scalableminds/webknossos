package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.google.inject.name.Named
import com.scalableminds.webknossos.datastore.services.DatasetErrorLoggingService
import org.apache.pekko.actor.ActorSystem
import play.api.inject.ApplicationLifecycle

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class TSDatasetErrorLoggingService @Inject()(
    val lifecycle: ApplicationLifecycle,
    @Named("webknossos-tracingstore") val actorSystem: ActorSystem)(implicit val ec: ExecutionContext)
    extends DatasetErrorLoggingService {
  protected val applicationHealthService: Option[Nothing] = None
}
