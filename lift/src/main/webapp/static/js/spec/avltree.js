
describe('avl_tree', function() {
  /*
    This test verifies that we can insert strings into the AvlTree and have
    them be stored and sorted correctly by the default comparator.
  */  it('should insert strings', function() {
    var i, tree, values;
    tree = new AvlTree();
    values = ['bill', 'blake', 'elliot', 'jacob', 'john', 'myles', 'ted'];
    tree.add(values[4]);
    tree.add(values[3]);
    tree.add(values[0]);
    tree.add(values[6]);
    tree.add(values[5]);
    tree.add(values[1]);
    tree.add(values[2]);
    i = 0;
    tree.inOrderTraverse(function(value) {
      expect(value).toEqual(values[i]);
      i += 1;
    });
    return expect(i).toEqual(values.length);
  });
  /*
    This test verifies that we can insert strings into and remove strings from
    the AvlTree and have the only the non-removed values be stored and sorted
    correctly by the default comparator.
  */
  it('should insert and remove strings', function() {
    var i, tree, values;
    tree = new AvlTree();
    values = ['bill', 'blake', 'elliot', 'jacob', 'john', 'myles', 'ted'];
    tree.add('frodo');
    tree.add(values[4]);
    tree.add(values[3]);
    tree.add(values[0]);
    tree.add(values[6]);
    tree.add('samwise');
    tree.add(values[5]);
    tree.add(values[1]);
    tree.add(values[2]);
    tree.add('pippin');
    expect(tree.remove('samwise')).toEqual('samwise');
    expect(tree.remove('pippin')).toEqual('pippin');
    expect(tree.remove('frodo')).toEqual('frodo');
    expect(tree.remove('merry')).toEqual(null);
    i = 0;
    tree.inOrderTraverse(function(value) {
      expect(values[i]).toEqual(value);
      i += 1;
    });
    return expect(i).toEqual(values.length);
  });
  /*
    This test verifies that we can insert values into and remove values from
    the AvlTree and have them be stored and sorted correctly by a custom
    comparator.
  */
  it('should insert numbers', function() {
    var NUM_TO_INSERT, i, tree, values, valuesToRemove, _ref;
    tree = new AvlTree(function(a, b) {
      return a - b;
    });
    NUM_TO_INSERT = 37;
    valuesToRemove = [1, 0, 6, 7, 36];
    values = [];
    for (i = 0; 0 <= NUM_TO_INSERT ? i < NUM_TO_INSERT : i > NUM_TO_INSERT; 0 <= NUM_TO_INSERT ? i++ : i--) {
      tree.add(i);
      values.push(i);
    }
    for (i = 0, _ref = valuesToRemove.length; 0 <= _ref ? i < _ref : i > _ref; 0 <= _ref ? i++ : i--) {
      expect(tree.remove(valuesToRemove[i])).toEqual(valuesToRemove[i]);
      Utils.arrayRemove(values, valuesToRemove[i]);
    }
    expect(tree.remove(-1)).toEqual(null);
    expect(tree.remove(37)).toEqual(null);
    i = 0;
    tree.inOrderTraverse(function(value) {
      expect(values[i]).toEqual(value);
      i += 1;
    });
    return expect(i).toEqual(values.length);
  });
  /*
    This test verifies that we can insert values into and remove values from
    the AvlTree and have it maintain the AVL-Tree upperbound on its height.
  */
  it('should balance', function() {
    var NUM_TO_INSERT, NUM_TO_REMOVE, i, tree;
    tree = new AvlTree(function(a, b) {
      return a - b;
    });
    NUM_TO_INSERT = 2000;
    NUM_TO_REMOVE = 500;
    for (i = 0; 0 <= NUM_TO_INSERT ? i < NUM_TO_INSERT : i > NUM_TO_INSERT; 0 <= NUM_TO_INSERT ? i++ : i--) {
      tree.add(i);
    }
    for (i = 0; 0 <= NUM_TO_REMOVE ? i < NUM_TO_REMOVE : i > NUM_TO_REMOVE; 0 <= NUM_TO_REMOVE ? i++ : i--) {
      tree.remove(i);
    }
    return expect(tree.getHeight() <= 1.4405 * (Math.log(NUM_TO_INSERT - NUM_TO_REMOVE + 2) / Math.log(2)) - 1.3277).toBeTruthy();
  });
  /*
     This test verifies that we can insert values into and remove values from
     the AvlTree and have its contains method correctly determine the values it
     is contains.
  */
  it('should know which elements it contains', function() {
    var i, tree, values, _ref;
    tree = new AvlTree();
    values = ['bill', 'blake', 'elliot', 'jacob', 'john', 'myles', 'ted'];
    tree.add('frodo');
    tree.add(values[4]);
    tree.add(values[3]);
    tree.add(values[0]);
    tree.add(values[6]);
    tree.add('samwise');
    tree.add(values[5]);
    tree.add(values[1]);
    tree.add(values[2]);
    tree.add('pippin');
    expect(tree.remove('samwise')).toEqual('samwise');
    expect(tree.remove('pippin')).toEqual('pippin');
    expect(tree.remove('frodo')).toEqual('frodo');
    for (i = 0, _ref = values.length; 0 <= _ref ? i < _ref : i > _ref; 0 <= _ref ? i++ : i--) {
      expect(tree.contains(values[i])).toBeTruthy();
    }
    expect(tree.contains('samwise')).toBeFalsy();
    expect(tree.contains('pippin')).toBeFalsy();
    return expect(tree.contains('frodo')).toBeFalsy();
  });
  /*
     This test verifies that we can insert values into and remove values from
     the AvlTree and have its minValue and maxValue routines return the correct
     min and max values contained by the tree.
  */
  it('should find min and max values', function() {
    var NUM_TO_INSERT, NUM_TO_REMOVE, i, tree;
    tree = new AvlTree(function(a, b) {
      return a - b;
    });
    NUM_TO_INSERT = 2000;
    NUM_TO_REMOVE = 500;
    for (i = 0; 0 <= NUM_TO_INSERT ? i < NUM_TO_INSERT : i > NUM_TO_INSERT; 0 <= NUM_TO_INSERT ? i++ : i--) {
      tree.add(i);
    }
    for (i = 0; 0 <= NUM_TO_REMOVE ? i < NUM_TO_REMOVE : i > NUM_TO_REMOVE; 0 <= NUM_TO_REMOVE ? i++ : i--) {
      tree.remove(i);
    }
    expect(tree.getMinimum()).toEqual(NUM_TO_REMOVE);
    return expect(tree.getMaximum()).toEqual(NUM_TO_INSERT - 1);
  });
  /*
     This test verifies that we can insert values into and remove values from
     the AvlTree and traverse the tree in reverse order using the
     reverseOrderTraverse routine.
  */
  it('should traverse in reverse order', function() {
    var NUM_TO_INSERT, NUM_TO_REMOVE, i, tree;
    tree = new AvlTree(function(a, b) {
      return a - b;
    });
    NUM_TO_INSERT = 2000;
    NUM_TO_REMOVE = 500;
    for (i = 0; 0 <= NUM_TO_INSERT ? i < NUM_TO_INSERT : i > NUM_TO_INSERT; 0 <= NUM_TO_INSERT ? i++ : i--) {
      tree.add(i);
    }
    for (i = 0; 0 <= NUM_TO_REMOVE ? i < NUM_TO_REMOVE : i > NUM_TO_REMOVE; 0 <= NUM_TO_REMOVE ? i++ : i--) {
      tree.remove(i);
    }
    i = NUM_TO_INSERT - 1;
    tree.reverseOrderTraverse(function(value) {
      expect(value).toEqual(i);
      i -= 1;
    });
    return expect(i).toEqual(NUM_TO_REMOVE - 1);
  });
  /*
     Verifies correct behavior of getCount(). See http:#b/4347755
  */
  return it('should count', function() {
    var tree;
    tree = new AvlTree();
    tree.add(1);
    tree.remove(1);
    return expect(0).toEqual(tree.getCount());
  });
});
