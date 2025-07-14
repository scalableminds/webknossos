package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.webknossos.datastore.IdWithBool.{Id32WithBool, Id64WithBool}

trait IdWithBoolUtils {
  // Protobuf classes Id32ToBool and Id64ToBool are used to store maps from id to boolean flags in annotation user state
  // This trait provides utility methods to mutate sequences of these, and conversions to and from Map and mutableMap
  // TODO naming!

  protected def id32WithBoolsToMutableMap(idWithBools: Seq[Id32WithBool]): collection.mutable.Map[Int, Boolean] =
    idWithBools.map { idWithBool =>
      (idWithBool.id, idWithBool.value)
    }.to(collection.mutable.Map)

  protected def mutableMapToId32WithBools(mutableMap: collection.mutable.Map[Int, Boolean]): Seq[Id32WithBool] =
    mutableMap.toSeq.map {
      case (id, value) => Id32WithBool(id, value)
    }

  protected def id64WithBoolsToMutableMap(idWithBools: Seq[Id64WithBool]): collection.mutable.Map[Long, Boolean] =
    idWithBools.map { idWithBool =>
      (idWithBool.id, idWithBool.value)
    }.to(collection.mutable.Map)

  protected def mutableMapToId64WithBools(mutableMap: collection.mutable.Map[Long, Boolean]): Seq[Id64WithBool] =
    mutableMap.toSeq.map {
      case (id, value) => Id64WithBool(id, value)
    }

  protected def id32WithBoolsToMap(idWithBoolsOpt: Option[Seq[Id32WithBool]]): Map[Int, Boolean] =
    idWithBoolsOpt.map { idWithBools =>
      idWithBools.map { idWithBool =>
        (idWithBool.id, idWithBool.value)
      }.toMap
    }.getOrElse(Map.empty[Int, Boolean])

  protected def id64WithBoolsToMap(idWithBoolsOpt: Option[Seq[Id64WithBool]]): Map[Long, Boolean] =
    idWithBoolsOpt.map { idWithBools =>
      idWithBools.map { idWithBool =>
        (idWithBool.id, idWithBool.value)
      }.toMap
    }.getOrElse(Map.empty[Long, Boolean])

  protected def mapToId32WithBools(idToBoolMap: Map[Int, Boolean]): Seq[Id32WithBool] =
    idToBoolMap.toSeq.map {
      case (id, value) => Id32WithBool(id, value)
    }

  protected def mapToId64WithBools(idToBoolMap: Map[Long, Boolean]): Seq[Id64WithBool] =
    idToBoolMap.toSeq.map {
      case (id, value) => Id64WithBool(id, value)
    }
}
