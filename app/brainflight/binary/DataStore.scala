package brainflight.binary

/**
 * Abstract Datastore defines all method a binary data source (e.q. normal file
 * system or db implementation) must implement to be used
 */
abstract class DataStore {
  /**
   * Loads the data of a given point from the data source
   */
  def load( point: Tuple3[Int, Int, Int] ): Byte

  /**
   * Gives the data store the possibility to clean up its mess on shutdown/clean 
   */
  def cleanUp()
}