package models.tracing.skeleton

import oxalis.nml.Edge
import org.bson.types.ObjectId

case class DBEdge(edge: Edge, _treeId: ObjectId, _id: ObjectId = new ObjectId)