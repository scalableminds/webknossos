###
Derived from http:#closure-library.googlecode.com/svn/docs/closure_goog_structs_avltree.js.source.html

---------------------------------------------------------------
Copyright 2007 The Closure Library Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

     http:#www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS-IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

###

class AvlTree
  
  constructor: (@comparator_) ->
    # default
    @comparator_ ?= (a, b) -> 
      if String(a) < String(b)
        -1
      else if String(a) > String(b)
        1
      else
        0
  
  root_: null
  minNode_: null
  maxNode_: null
  count_: null
  
  add: (value) ->
    # If the tree is empty, create a root node with the specified value
    if @root_ == null
      @.root_ = new Node(value)
      @minNode_ = @root_
      @maxNode_ = @root_
      @count_ = 1
      return true

    # Assume a node is not added and change status when one is
    retStatus = false

    # Depth traverse the tree and insert the value if we reach a null node
    @traverse_ (node) ->
      retNode = null
      if @comparator_(node.value, value) > 0
        retNode = node.left
        unless node.left?
          newNode = new Node(value, node)
          node.left = newNode
          if node == @minNode_
            @minNode_ = newNode

          retStatus = true # Value was added to tree
          @balance_(node) # Maintain the AVL-tree balance
      else if @comparator_(node.value, value) < 0
        retNode = node.right
        unless node.right?
          newNode = new Node(value, node)
          node.right = newNode
          if node == @maxNode_
            @maxNode_ = newNode
          retStatus = true # Value was added to tree
          @balance_(node) # Maintain the AVL-tree balance

      return retNode # If null, we'll stop traversing the tree
    

    # If a node was added, increment count
    @count_ += 1 if retStatus

    # Return true if a node was added, false otherwise
    retStatus
    
  remove: (value) ->
    # Assume the value is not removed and set the value when it is removed
    retValue = null

    # Depth traverse the tree and remove the value if we find it
    @traverse_ (node) ->
      retNode = null
      if @comparator_(node.value, value) > 0
        retNode = node.left
      else if @comparator_(node.value, value) < 0
        retNode = node.right
      else
        retValue = node.value
        @removeNode_(node)
        
      return retNode # If null, we'll stop traversing the tree
    

    # If a node was removed, decrement count.
    if retValue
      # Had traverse_() cleared the tree, set to 0.
      @count_ = if @root_ then @count_ - 1 else 0


    # Return the value that was removed, null if the value was not in the tree
    retValue
  
  clear: ->
    @root_ = null
    @minNode_ = null
    @maxNode_ = null
    @count_ = 0
  
  contains: (value) ->
    # Assume the value is not in the tree and set this value if it is found
    isContained = false

    # Depth traverse the tree and set isContained if we find the node
    @traverse_ (node) ->
      retNode = null
      if @comparator_(node.value, value) > 0
        retNode = node.left
      else if @comparator_(node.value, value) < 0
        retNode = node.right
      else
        isContained = true

      retNode # If null, we'll stop traversing the tree
    

    # Return true if the value is contained in the tree, false otherwise
    isContained
  
  getCount: ->
    @count_
    
  getMinimum: ->
    @getMinNode_().value
    
  getMaximum: ->
    @getMaxNode_().value
    
  getHeight: ->
    if @root_ then @root_.height else 0
    
  getValues: ->
    ret = []
    
    @inOrderTraverse (value) ->
      ret.push value
      
    ret
  
  inOrderTraverse: (func, opt_startValue) ->
    # If our tree is empty, return immediately
    return unless @root_

    # Depth traverse the tree to find node to begin in-order traversal from
    startNode
    if opt_startValue
      @traverse_ (node) ->
        retNode = null
        if @comparator_(node.value, opt_startValue) > 0
          retNode = node.left
          startNode = node
        else if @comparator_(node.value, opt_startValue) < 0
          retNode = node.right
        else
          startNode = node
        
        retNode # If null, we'll stop traversing the tree
    else
      startNode = @getMinNode_()

    # Traverse the tree and call func on each traversed node's value
    node = startNode
    prev = if startNode.left then startNode.left else startNode
    while node?
      if node.left? and node.left != prev and node.right != prev
        node = node.left
      else
        if node.right != prev
          return if func(node.value)
        temp = node
        node = if node.right != null and node.right != prev
            node.right
          else
            node.parent
        prev = temp
  
  reverseOrderTraverse: (func, opt_startValue) ->
    # If our tree is empty, return immediately
    return unless @root_

    # Depth traverse the tree to find node to begin reverse-order traversal from
    startNode
    if opt_startValue
      @traverse_ (node) =>
        retNode = null
        if @comparator_(node.value, opt_startValue) > 0
          retNode = node.left
        else if @comparator_(node.value, opt_startValue) < 0
          retNode = node.right
          startNode = node
        else
          startNode = node
        retNode # If null, we'll stop traversing the tree
    else
      startNode = @getMaxNode_()

    # Traverse the tree and call func on each traversed node's value
    node = startNode
    prev = if startNode.right then startNode.right else startNode
    while node?
      if node.right? and node.right != prev and node.left != prev
        node = node.right
      else
        if node.left != prev
          return if func(node.value)

        temp = node
        node = if node.left != null and node.left != prev
            node.left
          else
            node.parent
        prev = temp

  
  traverse_: (traversalFunc, opt_startNode, opt_endNode) ->
    node = if opt_startNode then opt_startNode else @root_
    endNode = if opt_endNode then opt_endNode else null
    while node and node != endNode
      node = traversalFunc.call(@, node)

  
  balance_: (node) ->

    @traverse_((node) ->
      # Calculate the left and right node's heights
      lh = if node.left then node.left.height else 0
      rh = if node.right then node.right.height else 0

      # Rotate tree rooted at @node if it is not AVL-tree balanced
      if lh - rh > 1
        if node.left.right and (!node.left.left or node.left.left.height < node.left.right.height)
          @leftRotate_(node.left)
        @rightRotate_(node)
      else if rh - lh > 1
        if node.right.left and (!node.right.right or node.right.right.height < node.right.left.height)
          @rightRotate_(node.right)
        @leftRotate_(node)

      # Recalculate the left and right node's heights
      lh = if node.left then node.left.height else 0
      rh = if node.right then node.right.height else 0

      # Set @node's height
      node.height = Math.max(lh, rh) + 1

      # Traverse up tree and balance parent
      node.parent
    , node)
  
  leftRotate_: (node) ->
    # Re-assign parent-child references for the parent of the node being removed
    if node.isLeftChild()
      node.parent.left = node.right
      node.right.parent = node.parent
    else if node.isRightChild()
      node.parent.right = node.right
      node.right.parent = node.parent
    else 
      @root_ = node.right
      @root_.parent = null


    # Re-assign parent-child references for the child of the node being removed
    temp = node.right
    node.right = node.right.left
    node.right.parent = node if node.right != null
    temp.left = node
    node.parent = temp
  
  
  rightRotate_: (node) ->
    # Re-assign parent-child references for the parent of the node being removed
    if node.isLeftChild()
      node.parent.left = node.left
      node.left.parent = node.parent
    else if node.isRightChild()
      node.parent.right = node.left
      node.left.parent = node.parent
    else
      @root_ = node.left
      @root_.parent = null

    # Re-assign parent-child references for the child of the node being removed
    temp = node.left
    node.left = node.left.right
    node.left.parent = node if node.left != null
    temp.right = node
    node.parent = temp

  
  removeNode_: (node) ->
    # Perform normal binary tree node removal, but balance the tree, starting
    # from where we removed the node
    if node.left != null or node.right != null
      b = null # Node to begin balance from
      r = null # Node to replace the node being removed
      if node.left != null
        r = @getMaxNode_(node.left)
        if r != node.left
          r.parent.right = r.left
          r.left.parent = r.parent if r.left
          r.left = node.left
          r.left.parent = r
          b = r.parent
        
        r.parent = node.parent
        r.right = node.right
        r.right.parent = r if r.right
        @maxNode_ = r if node == @maxNode_
      else
        r = @getMinNode_(node.right)
        if r != node.right
          r.parent.left = r.right
          r.right.parent = r.parent if r.right
          r.right = node.right
          r.right.parent = r
          b = r.parent
        
        r.parent = node.parent
        r.left = node.left
        r.left.parent = r if (r.left)
        @minNode_ = r if node == @minNode_
      

      # Update the parent of the node being removed to point to its replace
      if node.isLeftChild()
        node.parent.left = r
      else if node.isRightChild()
        node.parent.right = r
      else
        @root_ = r
      

      # Balance the tree
      @balance_(if b then b else r)
    else
      # If the node is a leaf, remove it and balance starting from its parent
      if node.isLeftChild()
        @special = 1
        node.parent.left = null
        @minNode_ = node.parent if node == @minNode_
        @balance_(node.parent)
      else if node.isRightChild()
        node.parent.right = null
        @maxNode_ = node.parent if node == @maxNode_
        @balance_(node.parent)
      else
        @clear()
  
  getMinNode_: (opt_rootNode) ->
    return @minNode_ unless opt_rootNode

    minNode = opt_rootNode
    @traverse_((node) ->
      retNode = null
      if node.left
        minNode = node.left
        retNode = node.left

      return retNode # If null, we'll stop traversing the tree
    , opt_rootNode)

    minNode

  getMaxNode_: (opt_rootNode) ->
    return @maxNode_ unless opt_rootNode
    
    maxNode = opt_rootNode
    @traverse_((node) ->
      retNode = null
      if node.right
        maxNode = node.right
        retNode = node.right
      
      retNode # If null, we'll stop traversing the tree
    , opt_rootNode)

    maxNode
  
  class Node
    constructor: (@value, @parent) ->
    
    left: null
    right: null
    height: 0
    
    isRightChild: ->
      !!@parent and @parent.right == @
    
    isLeftChild: ->
      !!@parent and @parent.left == @
