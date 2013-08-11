package models.knowledge

import brainflight.tools.geometry._
import play.api.libs.json._

sealed trait Segment {
  val id: Int
  val firstFrame: Double
  val lastFrame: Double
  val firstFrameRotated: Double
  val lastFrameRotated: Double
}

case class StartSegment(id: Int,
                        firstFrame: Double,
                        lastFrame: Double,
                        firstFrameRotated: Double,
                        lastFrameRotated: Double,
                        direction: Vector3D,
                        directionRotated: Vector3D) extends Segment

object StartSegment extends Function7[Int, Double, Double, Double, Double, Vector3D, Vector3D, StartSegment]{
  implicit val StartSegmentFormat: Format[StartSegment] = Json.format[StartSegment]
}                        

case class EndSegment(id: Int,
                      firstFrame: Double,
                      lastFrame: Double,
                      firstFrameRotated: Double,
                      lastFrameRotated: Double,
                      probability: Double) extends Segment
                      
object EndSegment extends Function6[Int, Double, Double, Double, Double, Double, EndSegment]{
  implicit val EndSegmentFormat: Format[EndSegment] = Json.format[EndSegment]
}                   

