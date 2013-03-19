package controllers.tracing.handler

import net.liftweb.common.Box
import models.tracing.TracingLike
import brainflight.security.AuthenticatedRequest
import models.tracing.TracingLike
import models.tracing.TracingType

object TracingInformationHandler {
  val informationHandlers: Map[String, TracingInformationHandler] = Map(
    TracingType.CompoundProject.toString ->
      ProjectInformationHandler,
    TracingType.CompoundTask.toString ->
      TaskInformationHandler,
    TracingType.CompoundTaskType.toString ->
      TaskTypeInformationHandler).withDefaultValue(SavedTracingInformationHandler)
}

trait TracingInformationHandler {
  def provideTracing(identifier: String): Box[TracingLike]

  def nameForTracing(identifier: String)(implicit request: AuthenticatedRequest[_]): Box[String] = {
    withTracing(identifier)(nameForTracing)
  }

  def nameForTracing(t: TracingLike): String = {
    t.id
  }

  def withTracing[A](identifier: String)(f: TracingLike => A)(implicit request: AuthenticatedRequest[_]): Box[A] = {
    provideTracing(identifier).map(f)
  }
  
  def cache: Boolean = true
}