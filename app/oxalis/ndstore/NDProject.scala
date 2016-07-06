/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.ndstore

case class NDProject(
  server: String, 
  name: String, 
  token: String, 
  dataset: NDDataSet, 
  channels: List[NDChannel])
