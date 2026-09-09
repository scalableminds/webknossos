package com.scalableminds.webknossos.tracingstore

import com.scalableminds.util.diagnostics.ThreadPoolHealthLogger
import org.apache.pekko.actor.ActorSystem
import play.api.inject.ApplicationLifecycle

import javax.inject.Inject
import scala.concurrent.ExecutionContext

// Registers periodic thread-pool health logging for the plain (unqualified) default ActorSystem, i.e. the one
// backing controller/request execution contexts, so this also runs in a standalone tracingstore deployment
// (which never loads app/Startup.scala). Dedupes with the main app's and the datastore's registration.
class TSThreadPoolHealthService @Inject() (actorSystem: ActorSystem, lifecycle: ApplicationLifecycle)(implicit
    ec: ExecutionContext
) {
  ThreadPoolHealthLogger.registerPeriodicLogging(actorSystem, lifecycle)
}
