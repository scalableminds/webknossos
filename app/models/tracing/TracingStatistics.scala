package models.tracing

import models.tracing.skeleton.{SkeletonTracing, SkeletonTracingStatistics}
import models.tracing.volume.VolumeTracingStatistics
import models.annotation.{AnnotationLike, AnnotationContent}
import play.api.Logger
import scala.concurrent.Future
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._

trait TracingStatistics{
  def writeAsJson = {
    this match {
      case stats: SkeletonTracingStatistics =>
        Json.toJson(stats)
      case _                                =>
        JsNull
    }
  }
}

trait AnnotationStatistics extends FoxImplicits { this: AnnotationLike =>
  def statisticsForAnnotation(): Fox[TracingStatistics] = {
    this.content.flatMap {
      case t: SkeletonTracing =>
        t.getOrCollectStatistics
      case _                  =>
        Logger.warn("No statistics available for content")
        Future.successful(VolumeTracingStatistics())
    }
  }
}
