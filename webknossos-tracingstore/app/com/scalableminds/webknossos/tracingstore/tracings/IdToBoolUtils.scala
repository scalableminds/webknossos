package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.webknossos.datastore.idToBool.{Id32ToBool, Id64ToBool}

trait IdToBoolUtils {
  // Protobuf classes Id32ToBool and Id64ToBool are used to store maps from id to boolean flags in annotation user state
  // This trait provides utility methods to mutate sequences of these, and conversions to and from Map and mutableMap
  // TODO naming!

  protected def id32BoolsToMutableMap(idBools: Seq[Id32ToBool]): collection.mutable.Map[Int, Boolean] =
    idBools.map { idBool =>
      (idBool.id, idBool.value)
    }.to(collection.mutable.Map)

  protected def mutableMapToId32Bools(mutableMap: collection.mutable.Map[Int, Boolean]): Seq[Id32ToBool] =
    mutableMap.toSeq.map {
      case (id, value) => Id32ToBool(id, value)
    }

  protected def id64BoolsToMutableMap(idBools: Seq[Id64ToBool]): collection.mutable.Map[Long, Boolean] =
    idBools.map { idBool =>
      (idBool.id, idBool.value)
    }.to(collection.mutable.Map)

  protected def mutableMapToId64Bools(mutableMap: collection.mutable.Map[Long, Boolean]): Seq[Id64ToBool] =
    mutableMap.toSeq.map {
      case (id, value) => Id64ToBool(id, value)
    }

  protected def id32BoolsToMap(idBoolsOpt: Option[Seq[Id32ToBool]]): Map[Int, Boolean] =
    idBoolsOpt.map { idBools =>
      idBools.map { idBool =>
        (idBool.id, idBool.value)
      }.toMap
    }.getOrElse(Map.empty[Int, Boolean])

  protected def id64BoolsToMap(idBoolsOpt: Option[Seq[Id64ToBool]]): Map[Long, Boolean] =
    idBoolsOpt.map { idBools =>
      idBools.map { idBool =>
        (idBool.id, idBool.value)
      }.toMap
    }.getOrElse(Map.empty[Long, Boolean])

  protected def mapToId32Bools(idBoolMap: Map[Int, Boolean]): Seq[Id32ToBool] =
    idBoolMap.toSeq.map {
      case (id, value) => Id32ToBool(id, value)
    }

  protected def mapToId64Bools(idBoolMap: Map[Long, Boolean]): Seq[Id64ToBool] =
    idBoolMap.toSeq.map {
      case (id, value) => Id64ToBool(id, value)
    }
}
