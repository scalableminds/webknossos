package models.tracing.skeleton

import models.annotation.Annotation
import play.api.Logger

trait AnnotationStatistics {
  def statisticsForAnnotation(annotation: Annotation) = {
    annotation.content.map {
      case t: SkeletonTracing =>
        val trees = t.dbtrees
        val numberOfTrees = trees.size
        val (numberOfNodes, numberOfEdges) = trees.foldLeft((0l, 0l)) {
          case ((numberOfNodes, numberOfEdges), tree) =>
            (numberOfNodes + tree.numberOfNodes,
              numberOfEdges + tree.numberOfEdges)
        }
        SkeletonTracingStatistic(numberOfNodes, numberOfEdges, numberOfTrees)
      case _ =>
        Logger.warn("No statistics available for content")
        SkeletonTracingStatistic(0, 0, 0)
    }
  }
}

case class SkeletonTracingStatistic(
                             numberOfNodes: Long,
                             numberOfEdges: Long,
                             numberOfTrees: Long)