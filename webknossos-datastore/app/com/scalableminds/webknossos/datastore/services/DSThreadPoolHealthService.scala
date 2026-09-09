package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.diagnostics.ThreadPoolHealthLogger
import org.apache.pekko.actor.ActorSystem
import play.api.inject.ApplicationLifecycle

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class DSThreadPoolHealthService @Inject() (actorSystem: ActorSystem, lifecycle: ApplicationLifecycle)(implicit
    ec: ExecutionContext
) {
  ThreadPoolHealthLogger.registerPeriodicLogging(actorSystem, lifecycle)
}
