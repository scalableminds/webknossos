# from: http://code.google.com/p/closure-library/source/browse/trunk/closure/goog/structs/avltree_test.html
describe 'avl_tree', ->
  ###
  This test verifies that we can insert strings into the AvlTree and have
  them be stored and sorted correctly by the default comparator.
  ###
  it 'should insert strings', ->
  
    tree = new AvlTree()
    values = ['bill', 'blake', 'elliot', 'jacob', 'john', 'myles', 'ted']

    # Insert strings into tree out of order
    tree.add(values[4])
    tree.add(values[3])
    tree.add(values[0])
    tree.add(values[6])
    tree.add(values[5])
    tree.add(values[1])
    tree.add(values[2])

    # Verify strings are stored in sorted order
    i = 0
    tree.inOrderTraverse (value) ->
      expect(value).toEqual(values[i])
      i += 1
      return
    
    expect(i).toEqual(values.length)
  

  ###
  This test verifies that we can insert strings into and remove strings from
  the AvlTree and have the only the non-removed values be stored and sorted
  correctly by the default comparator.
  ###
  it 'should insert and remove strings', ->
    tree = new AvlTree()
    values = ['bill', 'blake', 'elliot', 'jacob', 'john', 'myles', 'ted']

    # Insert strings into tree out of order
    tree.add('frodo')
    tree.add(values[4])
    tree.add(values[3])
    tree.add(values[0])
    tree.add(values[6])
    tree.add('samwise')
    tree.add(values[5])
    tree.add(values[1])
    tree.add(values[2])
    tree.add('pippin')

    # Remove strings from tree
    expect(tree.remove('samwise')).toEqual('samwise')
    expect(tree.remove('pippin')).toEqual('pippin')
    expect(tree.remove('frodo')).toEqual('frodo')
    expect(tree.remove('merry')).toEqual(null)


    # Verify strings are stored in sorted order
    i = 0
    tree.inOrderTraverse (value) ->
      expect(values[i]).toEqual(value)
      i += 1
      return
    
    expect(i).toEqual(values.length)

  ###
  This test verifies that we can insert values into and remove values from
  the AvlTree and have them be stored and sorted correctly by a custom
  comparator.
  ###
  it 'should insert numbers', ->
    tree = new AvlTree (a, b) -> a - b

    NUM_TO_INSERT = 37
    valuesToRemove = [1, 0, 6, 7, 36]

    # Insert ints into tree out of order
    values = []
    for i in [0...NUM_TO_INSERT]
      tree.add(i)
      values.push(i)
    

    for i in [0...valuesToRemove.length]
      expect(tree.remove(valuesToRemove[i])).toEqual(valuesToRemove[i])
      Utils.arrayRemove values, valuesToRemove[i]
    
    expect(tree.remove(-1)).toEqual(null)
    expect(tree.remove(37)).toEqual(null)

    # Verify strings are stored in sorted order
    i = 0
    tree.inOrderTraverse (value) ->
      expect(values[i]).toEqual(value)
      i += 1
      return
      
    expect(i).toEqual(values.length)

  ###
  This test verifies that we can insert values into and remove values from
  the AvlTree and have it maintain the AVL-Tree upperbound on its height.
  ###
  it 'should balance', ->
    tree = new AvlTree (a, b) -> a - b
    

    NUM_TO_INSERT = 2000
    NUM_TO_REMOVE = 500

    # Insert ints into tree out of order
    for i in [0...NUM_TO_INSERT]
      tree.add(i)

    # Remove valuse
    for i in [0...NUM_TO_REMOVE]
      tree.remove(i)

    expect(tree.getHeight() <= 1.4405 *
        (Math.log(NUM_TO_INSERT - NUM_TO_REMOVE + 2) / Math.log(2)) - 1.3277).toBeTruthy()

  ###
   This test verifies that we can insert values into and remove values from
   the AvlTree and have its contains method correctly determine the values it
   is contains.
  ###
  it 'should know which elements it contains', ->
    tree = new AvlTree()
    values = ['bill', 'blake', 'elliot', 'jacob', 'john', 'myles', 'ted']

    # Insert strings into tree out of order
    tree.add('frodo')
    tree.add(values[4])
    tree.add(values[3])
    tree.add(values[0])
    tree.add(values[6])
    tree.add('samwise')
    tree.add(values[5])
    tree.add(values[1])
    tree.add(values[2])
    tree.add('pippin')

    # Remove strings from tree
    expect(tree.remove('samwise')).toEqual('samwise')
    expect(tree.remove('pippin')).toEqual('pippin')
    expect(tree.remove('frodo')).toEqual('frodo')

    for i in [0...values.length]
      expect(tree.contains(values[i])).toBeTruthy()

    expect(tree.contains('samwise')).toBeFalsy()
    expect(tree.contains('pippin')).toBeFalsy()
    expect(tree.contains('frodo')).toBeFalsy()
  

  ###
   This test verifies that we can insert values into and remove values from
   the AvlTree and have its minValue and maxValue routines return the correct
   min and max values contained by the tree.
  ###
  it 'should find min and max values', ->
    tree = new AvlTree (a, b) -> a - b

    NUM_TO_INSERT = 2000
    NUM_TO_REMOVE = 500

    # Insert ints into tree out of order
    for i in [0...NUM_TO_INSERT]
      tree.add(i);

    # Remove valuse
    for i in [0...NUM_TO_REMOVE]
      tree.remove(i)
    

    expect(tree.getMinimum()).toEqual(NUM_TO_REMOVE)
    expect(tree.getMaximum()).toEqual(NUM_TO_INSERT - 1)

  ###
   This test verifies that we can insert values into and remove values from
   the AvlTree and traverse the tree in reverse order using the
   reverseOrderTraverse routine.
  ###
  it 'should traverse in reverse order', ->
    tree = new AvlTree (a, b) -> a - b

    NUM_TO_INSERT = 2000
    NUM_TO_REMOVE = 500

    # Insert ints into tree out of order
    for i in [0...NUM_TO_INSERT]
      tree.add(i)

    # Remove valuse
    for i in [0...NUM_TO_REMOVE]
      tree.remove(i)

    i = NUM_TO_INSERT - 1;
    tree.reverseOrderTraverse (value) ->
      expect(value).toEqual(i)
      i -= 1
      return
    
    expect(i).toEqual(NUM_TO_REMOVE - 1)


  ###
   Verifies correct behavior of getCount(). See http:#b/4347755
  ###
  it 'should count', ->
    tree = new AvlTree()
    tree.add(1)
    tree.remove(1)
    expect(0).toEqual(tree.getCount())