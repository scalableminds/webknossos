package oxalis.opengraph

import com.scalableminds.util.enumeration.ExtendedEnumeration

object OpenGraphPageType extends ExtendedEnumeration {
  type OpenGraphPageType = Value
  val dataset, annotation, workflow, unknown = Value
}
