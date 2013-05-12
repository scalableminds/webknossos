package models.tracing

import play.api.libs.json.Writes
import play.api.libs.json.Json
import braingames.xml.XMLWrites
import braingames.xml.Xml
import oxalis.nml.Node
import org.bson.types.ObjectId

case class DBNode(node: Node, _treeId: ObjectId, _id: ObjectId = new ObjectId)