package models.tracing.skeleton

import oxalis.nml.Node
import org.bson.types.ObjectId

case class DBNode(node: Node, _treeId: ObjectId, _id: ObjectId = new ObjectId)