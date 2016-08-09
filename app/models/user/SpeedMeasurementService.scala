/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.user

import com.scalableminds.util.tools.FoxImplicits
import play.api.libs.concurrent.Akka
import akka.actor.{Actor, Props}
import models.annotation.Annotation
import com.scalableminds.util.reactivemongo.DBAccessContext
import models.tracing.skeleton.SkeletonTracing
import oxalis.nml.{Node, TreeLike}
import play.api.Play.current
import com.scalableminds.util.geometry.Scale
import com.scalableminds.braingames.binary.models.DataSource
import com.scalableminds.util.mail.Send
import models.user.time.TimeSpanService
import oxalis.mail.DefaultMails

object SpeedMeasurementService extends FoxImplicits {
  val maxRoundTripTime = 155.0 //ms
  val minBandwidth = 31250 // Bytes/s (is scaled with avg BitDepth)
  val moveRatio = 0.75
  lazy val speedMeasurement = Akka.system.actorOf(Props[SpeedMeasurement])
  lazy val Mailer =
    Akka.system(play.api.Play.current).actorSelection("/user/mailActor")

  def startSpeedMeasurement(annotation: Annotation)(implicit ctx: DBAccessContext): Unit = {
    val timestamp = System.currentTimeMillis

    speedMeasurement ! MeasureSpeed(annotation, ctx)
  }

  case class MeasureSpeed(annotation: Annotation, ctx: DBAccessContext)

  class SpeedMeasurement extends Actor {

    def receive = {
      case MeasureSpeed(annotation, ctx) => execute(annotation)(ctx)
    }

    def execute(annotation: Annotation)(implicit ctx: DBAccessContext) = for {
      tracing <- annotation._content.resolveAs[SkeletonTracing]
      trees <- tracing.trees
      dataSet <- tracing.dataSet
      user <- annotation.user
    } yield {
      val scale = dataSet.dataSource.getOrElse(new DataSource("", "", Scale(1, 1, 1))).scale
      val nodes = trees.flatMap(_.nodes)
      val roundTripTime = tracing.roundTripTime.getOrElse(0.0)
      val bandwidth = tracing.bandwidth.getOrElse(10.0 * minBandwidth)
      val avgBitDepth = if (nodes.isEmpty)
        8.0
      else
        1.0 * nodes.map(_.bitDepth).sum / nodes.length
      val avgMoveValue = nodes.map(_.withSpeed).sum / nodes.length
      val tracingSpeed = tracingLength(trees)(scale) / tracingTime(trees) * 1000 // in nm/s
      if ((roundTripTime > maxRoundTripTime)
        || (bandwidth < minBandwidth * avgBitDepth)
        || (tracingSpeed < moveRatio * avgMoveValue)) {
          Mailer ! Send(DefaultMails.slowUserAdminNotifyerMail(
            user,
            roundTripTime,
            bandwidth,
            avgBitDepth,
            avgMoveValue,
            tracingSpeed: Double
          ))
        }
    }

    def scaleNode(node: Node)(implicit scale: Scale): List[Double] =
      List(node.position.x * scale.x,
        node.position.y * scale.y,
        node.position.z * scale.z)

    def tracingLength(trees: List[TreeLike])(implicit scale: Scale) = {
      val nodesScaled = trees.flatMap(_.nodes).map(scaleNode)
      val edgesScaled = for {
        edge <- trees.flatMap(_.edges)
      } yield {
        (nodesScaled(edge.source), nodesScaled(edge.target)).
          zipped.
          map((x: Double, y: Double) => x - y).
          sum
      }
      edgesScaled.map(Math.sqrt).sum
    }

    def tracingTime(trees: List[TreeLike]) = {
      val nodes = trees.flatMap(_.nodes).map(_.timestamp).sorted
      (nodes.drop(1), nodes.dropRight(1))
        .zipped
        .map((x: Long, y: Long) => x - y)
        .filter(_ < TimeSpanService.MaxTracingPause)
        .sum
    }
  }
}





