/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.tracing.skeleton.temporary

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationContentService, AnnotationSettings}
import models.binary.{DataSet, DataSetDAO}
import models.tracing.skeleton.{SkeletonTracingLike, SkeletonTracing, SkeletonTracingStatistics}
import net.liftweb.common.Full
import oxalis.nml.NML
import play.api.libs.concurrent.Execution.Implicits._

object TemporarySkeletonTracingService extends AnnotationContentService with FoxImplicits{

  private def defaultDataSetPosition(dataSetName: String)(implicit ctx: DBAccessContext) = {
    DataSetDAO.findOneBySourceName(dataSetName).futureBox.map {
      case Full(dataSet) =>
        dataSet.defaultStart
      case _ =>
        Point3D(0, 0, 0)
    }
  }

  def createFrom(nml: NML, id: String, boundingBox: Option[BoundingBox], settings: AnnotationSettings = AnnotationSettings.default)(implicit ctx: DBAccessContext) = {
    val box = boundingBox.flatMap { box => if (box.isEmpty) None else Some(box) }
    val start = nml.editPosition.toFox.orElse(defaultDataSetPosition(nml.dataSetName))

    start.map {
      TemporarySkeletonTracing(
        id,
        nml.dataSetName,
        nml.trees,
        System.currentTimeMillis(),
        nml.activeNodeId,
        _,
        Vector3D(0,0,0),
        SkeletonTracing.defaultZoomLevel,
        box,
        settings)
    }
  }

  def createFrom(tracing: SkeletonTracingLike, id: String)(implicit ctx: DBAccessContext) = {
    for {
      trees <- tracing.trees
    } yield {
      TemporarySkeletonTracing(
        id,
        tracing.dataSetName,
        trees,
        System.currentTimeMillis(),
        tracing.activeNodeId,
        tracing.editPosition,
        tracing.editRotation,
        tracing.zoomLevel,
        tracing.boundingBox,
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

  def clearAndRemove(id: String)(implicit ctx: DBAccessContext) = ???

  def updateSettings(dataSetName: String, boundingBox: Option[BoundingBox], settings: AnnotationSettings, tracingId: String)(implicit ctx: DBAccessContext): Fox[Boolean] = ???

  def updateEditPosRot(editPosition: Point3D, rotation: Vector3D, tracingId: String)(implicit ctx: DBAccessContext): Fox[Boolean] = ???
}
