package models.tracing.skeleton

import models.annotation.{AnnotationLike, Annotation}
import play.api.Logger
import scala.concurrent.Future
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{Json, JsObject}

trait AnnotationStatistics extends FoxImplicits { this: AnnotationLike =>
  def statisticsForAnnotation() = {
    this.content.flatMap {
      case t: SkeletonTracing =>
        for {
          trees <- t.DBTrees.toFox
          numberOfTrees = trees.size
          (numberOfNodes, numberOfEdges) <- trees.foldLeft(Fox.successful((0l, 0l))) {
            case (f, tree) =>
              for {
                (numberOfNodes, numberOfEdges) <- f.toFox
                nNodes <- tree.numberOfNodes
                nEdges <- tree.numberOfEdges
              } yield {
                (numberOfNodes + nNodes, numberOfEdges + nEdges)
              }
          }
        } yield {
          SkeletonTracingStatistic(numberOfNodes, numberOfEdges, numberOfTrees)
        }
      case _ =>
        Logger.debug("No statistics available for content")
        Fox.successful(SkeletonTracingStatistic(0, 0, 0))
    }
  }
}

case class SkeletonTracingStatistic(
                                     numberOfNodes: Long,
                                     numberOfEdges: Long,
                                     numberOfTrees: Long
                                   )

object SkeletonTracingStatistic {
  implicit val skeletonTracingStatisticFormat = Json.format[SkeletonTracingStatistic]
}
