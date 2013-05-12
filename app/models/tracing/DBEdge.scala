package models.tracing

import play.api.libs.json.Writes
import play.api.libs.json.Json
import braingames.xml.XMLWrites
import braingames.xml.Xml
import oxalis.nml.Edge
import org.bson.types.ObjectId

case class DBEdge(edge: Edge, _treeId: ObjectId, _id: ObjectId = new ObjectId)