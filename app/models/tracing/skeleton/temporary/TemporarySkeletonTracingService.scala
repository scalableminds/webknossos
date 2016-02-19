/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.tracing.skeleton.temporary

import com.scalableminds.util.geometry.{Point3D, BoundingBox}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import models.annotation.{AnnotationSettings, AnnotationContentService}
import models.binary.{DataSet, DataSetDAO}
import models.tracing.skeleton.{SkeletonTracingLike, SkeletonTracing}
import net.liftweb.common.Full
import oxalis.nml.NML
import play.api.libs.concurrent.Execution.Implicits._

object TemporarySkeletonTracingService extends AnnotationContentService {
  def createFrom(nml: NML, id: String, boundingBox: Option[BoundingBox], settings: AnnotationSettings = AnnotationSettings.default)(implicit ctx: DBAccessContext) = {
    val box = boundingBox.flatMap { box => if (box.isEmpty) None else Some(box) }
    val start = DataSetDAO.findOneBySourceName(nml.dataSetName).futureBox.map {
      case Full(dataSet) =>
        dataSet.defaultStart
      case _ =>
        Point3D(0, 0, 0)
    }

    start.map {
      TemporarySkeletonTracing(
        id,
        nml.dataSetName,
        nml.trees,
        nml.branchPoints,
        System.currentTimeMillis(),
        nml.activeNodeId,
        _,
        SkeletonTracing.defaultZoomLevel,
        box,
        nml.comments,
        settings)
    }.toFox
  }

  def createFrom(tracing: SkeletonTracingLike, id: String)(implicit ctx: DBAccessContext) = {
    for {
      trees <- tracing.trees
    } yield {
      TemporarySkeletonTracing(
        id,
        tracing.dataSetName,
        trees,
        tracing.branchPoints,
        System.currentTimeMillis(),
        tracing.activeNodeId,
        tracing.editPosition,
        tracing.zoomLevel,
        tracing.boundingBox,
        tracing.comments,
        tracing.settings)
    }
  }

  def createFrom(nmls: List[NML], boundingBox: Option[BoundingBox], settings: AnnotationSettings)(implicit ctx: DBAccessContext): Fox[TemporarySkeletonTracing] = {
    nmls match {
      case head :: tail =>
        val startTracing = createFrom(head, head.timestamp.toString, boundingBox, settings)

        tail.foldLeft(startTracing) {
          case (f, s) =>
            for {
              t <- f
              n <- createFrom(s, s.timestamp.toString, boundingBox)
              r <- t.mergeWith(n)
            } yield {
              r
            }
        }
      case _ =>
        Fox.empty
    }
  }

  type AType = TemporarySkeletonTracing

  def updateSettings(settings: AnnotationSettings, tracingId: String)(implicit ctx: DBAccessContext) = ???

  def findOneById(id: String)(implicit ctx: DBAccessContext) = ???

  def createFrom(dataSet: DataSet)(implicit ctx: DBAccessContext) = ???

  def clearTracingData(id: String)(implicit ctx: DBAccessContext) = ???

  def updateSettings(dataSetName: String, boundingBox: Option[BoundingBox], settings: AnnotationSettings, tracingId: String)(implicit ctx: DBAccessContext): Fox[Boolean] = ???

  def updateEditPosition(editPosition: Point3D, tracingId: String)(implicit ctx: DBAccessContext): Fox[Boolean] = ???
}
