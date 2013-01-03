package models.graph

import xml.XMLWrites
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
  
  implicit object CommentXMLWrites extends XMLWrites[Comment] {
    def writes(n: Comment) =
      <comment node={ n.node.toString } content={ n.content } />
  }
}