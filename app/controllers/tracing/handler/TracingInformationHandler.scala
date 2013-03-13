package controllers.tracing.handler

import net.liftweb.common.Box
import models.tracing.TracingLike
import brainflight.security.AuthenticatedRequest
import models.tracing.TracingLike

trait TracingInformationHandler{
  def provideTracing(identifier: String)(implicit request: AuthenticatedRequest[_]): Box[TracingLike]
  
  
  def nameForTracing(identifier: String)(implicit request: AuthenticatedRequest[_]): Box[String] = {
    withTracing(identifier)( nameForTracing)
  }
  
  def nameForTracing(t: TracingLike): String = {
    t.id
  }
  
  def withTracing[A](identifier: String)(f: TracingLike => A)(implicit request: AuthenticatedRequest[_]): Box[A] = {
    provideTracing(identifier).map(f)
  }
}