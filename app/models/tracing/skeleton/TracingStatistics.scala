package models.tracing.skeleton

import models.annotation.Annotation
import play.api.Logger

trait AnnotationStatistics {
  def statisticsForAnnotation(annotation: Annotation) = {
    annotation.content.map {
      case t: Tracing =>
        val trees = t.dbtrees
        val numberOfTrees = trees.size
        val (numberOfNodes, numberOfEdges) = trees.foldLeft((0l, 0l)) {
          case ((numberOfNodes, numberOfEdges), tree) =>
            (numberOfNodes + tree.numberOfNodes,
              numberOfEdges + tree.numberOfEdges)
        }
        TracingStatistic(numberOfNodes, numberOfEdges, numberOfTrees)
      case _ =>
        Logger.warn("No statistics available for content")
        TracingStatistic(0, 0, 0)
    }
  }
}

case class TracingStatistic(
                             numberOfNodes: Long,
                             numberOfEdges: Long,
                             numberOfTrees: Long)