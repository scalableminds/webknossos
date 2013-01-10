package brainflight.tools.geometry

import play.api.libs.json._
import play.api.libs.json.Json._
import play.api.libs.json.Writes._

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 20.12.11
 * Time: 12:22
 */

case class Point3D(x: Int, y:Int, z:Int){
  def scale( f: (Int, Int) => Int ) = 
    Point3D( f(x, 0), f(y, 1), f(z, 2) )
    
  def hasGreaterCoordinateAs( other: Point3D ) = 
    x > other.x || y > other.y || z > other.z
    
  override def toString = "(%d, %d, %d)".format(x,y,z)
}

object Point3D{
  val formRx = "\\s*([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*".r
  def toForm(p: Point3D) = Some( "%d, %d, %d".format(p.x,p.y,p.z))  
  
  def fromForm(s: String) = {
    s match{
      case formRx(x,y,z) =>
        Point3D(Integer.parseInt(x),Integer.parseInt(y),Integer.parseInt(z))
      case _ =>
        null
    }
  }
  
  def fromArray[T <%Int ](array: Array[T]) = 
    if( array.size >= 3 )
      Some( Point3D( array(0), array(1), array(2) ) )
    else
      None
      
  implicit object Point3DReads extends Reads[Point3D] {
    def reads(json: JsValue) = json match {
      case JsArray(ts) if ts.size==3 =>
        val c = ts.map(fromJson[Int](_))
        Point3D(c(0),c(1),c(2))
      case _ => throw new RuntimeException("List expected")
    }
  }
  
  implicit object Point3DWrites extends Writes[Point3D] {
    def writes(v: Point3D) = {
      val l = List(v.x, v.y, v.z)
      JsArray(l.map(toJson(_)))
    }
  }
}