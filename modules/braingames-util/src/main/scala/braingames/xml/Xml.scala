package braingames.xml

import scala.xml.{NodeSeq, Node}
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits._

object Xml {
  def toXML[T](t: T)(implicit w: XMLWrites[T]): Future[Node] = w.writes(t)
  def toXML[T](t: Seq[T])(implicit w: XMLWrites[T]): Future[List[Node]] = Future.sequence(t.map(w.writes(_)).toList)
}