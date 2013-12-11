package models.tracing.skeleton

import models.annotation.Annotation
import play.api.Logger
import scala.concurrent.Future
import braingames.util.{FoxImplicits, Fox}
import play.api.libs.concurrent.Execution.Implicits._

trait AnnotationStatistics extends FoxImplicits {
  def statisticsForAnnotation(annotation: Annotation) = {
    annotation.content.flatMap {
      case t: SkeletonTracing =>
        for {
          trees <- t.dbtrees.toFox
          numberOfTrees = trees.size
          (numberOfNodes, numberOfEdges) <- trees.foldLeft(Future.successful((0l, 0l))) {
            case (f, tree) =>
              for {
                (numberOfNodes, numberOfEdges) <- f
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
        Logger.warn("No statistics available for content")
        Fox.successful(SkeletonTracingStatistic(0, 0, 0))
    }
  }
}

case class SkeletonTracingStatistic(
                                     numberOfNodes: Long,
                                     numberOfEdges: Long,
                                     numberOfTrees: Long
                                   )