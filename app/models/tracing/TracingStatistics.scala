package models.tracing

trait TracingStatistics {
  def statisticsForTracing(tracing: Tracing) = {
    val trees = tracing.dbtrees
    val numberOfTrees = trees.size
    val (numberOfNodes, numberOfEdges) = trees.foldLeft((0l, 0l)) {
      case ((numberOfNodes, numberOfEdges), tree) =>
        (numberOfNodes + tree.numberOfNodes,
          numberOfEdges + tree.numberOfEdges)
    }
    TracingStatistic(numberOfNodes, numberOfEdges, numberOfTrees)
  }
}

case class TracingStatistic(
  numberOfNodes: Long,
  numberOfEdges: Long,
  numberOfTrees: Long)