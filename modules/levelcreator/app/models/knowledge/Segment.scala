package models.knowledge

import play.api.libs.json._
import braingames.geometry.Vector3D

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

object StartSegment{
  implicit val StartSegmentFormat: Format[StartSegment] = Json.format[StartSegment]
}                        

case class EndSegment(id: Int,
                      firstFrame: Double,
                      lastFrame: Double,
                      firstFrameRotated: Double,
                      lastFrameRotated: Double,
                      probability: Double) extends Segment
                      
object EndSegment{
  implicit val EndSegmentFormat: Format[EndSegment] = Json.format[EndSegment]
}             

case class SimpleSegment(id: Int)

object SimpleSegment{
  implicit val SimpleSegmentFormat: Format[SimpleSegment] = Json.format[SimpleSegment]
}

