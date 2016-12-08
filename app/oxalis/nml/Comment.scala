package oxalis.nml

import javax.xml.stream.XMLStreamWriter

import com.scalableminds.util.xml.SynchronousXMLWrites
import play.api.libs.json._

case class Comment(node: Int, content: String)

object Comment {

  implicit object CommentFormat extends Format[Comment] {
    val NODE = "node"
    val CONTENT = "content"

    def writes(e: Comment) = Json.obj(
      NODE -> e.node,
      CONTENT -> e.content)

    def reads(js: JsValue) =
      JsSuccess(Comment((js \ NODE).as[Int],
        (js \ CONTENT).as[String]))
  }

  implicit object CommentXMLWrites extends SynchronousXMLWrites[Comment] {
    def synchronousWrites(n: Comment)(implicit writer: XMLStreamWriter): Boolean = {
      writer.writeStartElement("comment")
      writer.writeAttribute("node", n.node.toString)
      writer.writeAttribute("content", n.content)
      writer.writeEndElement()
      true
    }
  }

}
