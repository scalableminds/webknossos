package models.tracing

import play.api.libs.json.Writes
import play.api.libs.json.Json
import xml.XMLWrites
import xml.Xml
import nml.Node
import org.bson.types.ObjectId

case class DBNode(node: Node, _treeId: ObjectId, _id: ObjectId = new ObjectId)