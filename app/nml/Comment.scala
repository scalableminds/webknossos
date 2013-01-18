package nml

import xml.XMLWrites
import play.api.libs.json.Format
import play.api.libs.json.Json
import play.api.libs.json.JsValue
import play.api.libs.json.Json.toJsFieldJsValueWrapper

case class Comment(node: Int, content: String)

object Comment {
  
  implicit object CommentFormat extends Format[Comment] {
    val NODE = "node"
    val CONTENT = "content"
    def writes(e: Comment) = Json.obj(
      NODE -> e.node,
      CONTENT -> e.content)

    def reads(js: JsValue) =
      Comment((js \ NODE).as[Int],
        (js \ CONTENT).as[String])
  }
  
  implicit object CommentXMLWrites extends XMLWrites[Comment] {
    def writes(n: Comment) =
      <comment node={ n.node.toString } content={ n.content } />
  }
}