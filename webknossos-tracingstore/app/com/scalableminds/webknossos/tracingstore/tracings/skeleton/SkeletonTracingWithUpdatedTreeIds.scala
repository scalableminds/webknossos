package com.scalableminds.webknossos.tracingstore.tracings.skeleton

import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing

case class SkeletonTracingWithUpdatedTreeIds(
    skeletonTracing: SkeletonTracing,
    updatedTreeIds: Set[Int] // Encodes which tree bodies are changed and need to be flushed to fossilDB
) {
  def withVersion(newVersion: Long): SkeletonTracingWithUpdatedTreeIds =
    this.copy(skeletonTracing = this.skeletonTracing.withVersion(newVersion))

  def markAllTreeBodiesAsChanged: SkeletonTracingWithUpdatedTreeIds =
    this.copy(updatedTreeIds = skeletonTracing.trees.map(_.treeId).toSet)
}
