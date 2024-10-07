package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.tools.Fox

import scala.concurrent.ExecutionContext

trait AnnotationReversion {

  def revertDistributedElements(annotationId: String,
                                annotationWithTracings: AnnotationWithTracings,
                                revertAction: RevertToVersionUpdateAction)(implicit ec: ExecutionContext): Fox[Unit] =
    // TODO segment index, volume buckets, proofreading data
    Fox.successful(())

}
