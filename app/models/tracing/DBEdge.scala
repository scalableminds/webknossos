package models.tracing

import play.api.libs.json.Writes
import play.api.libs.json.Json
import xml.XMLWrites
import xml.Xml
import nml.Edge
import org.bson.types.ObjectId

case class DBEdge(edge: Edge, _treeId: ObjectId, _id: ObjectId = new ObjectId)