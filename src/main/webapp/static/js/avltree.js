
/*
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
*/

var AvlTree;

AvlTree = (function() {
  var Node;

  function AvlTree(comparator_) {
    var _ref;
    this.comparator_ = comparator_;
    if ((_ref = this.comparator_) == null) {
      this.comparator_ = function(a, b) {
        if (String(a) < String(b)) {
          return -1;
        } else if (String(a) > String(b)) {
          return 1;
        } else {
          return 0;
        }
      };
    }
  }

  AvlTree.prototype.root_ = null;

  AvlTree.prototype.minNode_ = null;

  AvlTree.prototype.maxNode_ = null;

  AvlTree.prototype.count_ = null;

  AvlTree.prototype.add = function(value) {
    var retStatus;
    if (this.root_ === null) {
      this.root_ = new Node(value);
      this.minNode_ = this.root_;
      this.maxNode_ = this.root_;
      this.count_ = 1;
      return true;
    }
    retStatus = false;
    this.traverse_(function(node) {
      var newNode, retNode;
      retNode = null;
      if (this.comparator_(node.value, value) > 0) {
        retNode = node.left;
        if (node.left == null) {
          newNode = new Node(value, node);
          node.left = newNode;
          if (node === this.minNode_) this.minNode_ = newNode;
          retStatus = true;
          this.balance_(node);
        }
      } else if (this.comparator_(node.value, value) < 0) {
        retNode = node.right;
        if (node.right == null) {
          newNode = new Node(value, node);
          node.right = newNode;
          if (node === this.maxNode_) this.maxNode_ = newNode;
          retStatus = true;
          this.balance_(node);
        }
      }
      return retNode;
    });
    if (retStatus) this.count_ += 1;
    return retStatus;
  };

  AvlTree.prototype.remove = function(value) {
    var retValue;
    retValue = null;
    this.traverse_(function(node) {
      var retNode;
      retNode = null;
      if (this.comparator_(node.value, value) > 0) {
        retNode = node.left;
      } else if (this.comparator_(node.value, value) < 0) {
        retNode = node.right;
      } else {
        retValue = node.value;
        this.removeNode_(node);
      }
      return retNode;
    });
    if (retValue) this.count_ = this.root_ ? this.count_ - 1 : 0;
    return retValue;
  };

  AvlTree.prototype.clear = function() {
    this.root_ = null;
    this.minNode_ = null;
    this.maxNode_ = null;
    return this.count_ = 0;
  };

  AvlTree.prototype.contains = function(value) {
    var isContained;
    isContained = false;
    this.traverse_(function(node) {
      var retNode;
      retNode = null;
      if (this.comparator_(node.value, value) > 0) {
        retNode = node.left;
      } else if (this.comparator_(node.value, value) < 0) {
        retNode = node.right;
      } else {
        isContained = true;
      }
      return retNode;
    });
    return isContained;
  };

  AvlTree.prototype.getCount = function() {
    return this.count_;
  };

  AvlTree.prototype.getMinimum = function() {
    return this.getMinNode_().value;
  };

  AvlTree.prototype.getMaximum = function() {
    return this.getMaxNode_().value;
  };

  AvlTree.prototype.getHeight = function() {
    if (this.root_) {
      return this.root_.height;
    } else {
      return 0;
    }
  };

  AvlTree.prototype.getValues = function() {
    var ret;
    ret = [];
    this.inOrderTraverse(function(value) {
      return ret.push(value);
    });
    return ret;
  };

  AvlTree.prototype.inOrderTraverse = function(func, opt_startValue) {
    var node, prev, startNode, temp, _results;
    if (!this.root_) return;
    startNode;
    if (opt_startValue) {
      this.traverse_(function(node) {
        var retNode, startNode;
        retNode = null;
        if (this.comparator_(node.value, opt_startValue) > 0) {
          retNode = node.left;
          startNode = node;
        } else if (this.comparator_(node.value, opt_startValue) < 0) {
          retNode = node.right;
        } else {
          startNode = node;
        }
        return retNode;
      });
    } else {
      startNode = this.getMinNode_();
    }
    node = startNode;
    prev = startNode.left ? startNode.left : startNode;
    _results = [];
    while (node != null) {
      if ((node.left != null) && node.left !== prev && node.right !== prev) {
        _results.push(node = node.left);
      } else {
        if (node.right !== prev) if (func(node.value)) return;
        temp = node;
        node = node.right !== null && node.right !== prev ? node.right : node.parent;
        _results.push(prev = temp);
      }
    }
    return _results;
  };

  AvlTree.prototype.reverseOrderTraverse = function(func, opt_startValue) {
    var node, prev, startNode, temp, _results;
    var _this = this;
    if (!this.root_) return;
    startNode;
    if (opt_startValue) {
      this.traverse_(function(node) {
        var retNode, startNode;
        retNode = null;
        if (_this.comparator_(node.value, opt_startValue) > 0) {
          retNode = node.left;
        } else if (_this.comparator_(node.value, opt_startValue) < 0) {
          retNode = node.right;
          startNode = node;
        } else {
          startNode = node;
        }
        return retNode;
      });
    } else {
      startNode = this.getMaxNode_();
    }
    node = startNode;
    prev = startNode.right ? startNode.right : startNode;
    _results = [];
    while (node != null) {
      if ((node.right != null) && node.right !== prev && node.left !== prev) {
        _results.push(node = node.right);
      } else {
        if (node.left !== prev) if (func(node.value)) return;
        temp = node;
        node = node.left !== null && node.left !== prev ? node.left : node.parent;
        _results.push(prev = temp);
      }
    }
    return _results;
  };

  AvlTree.prototype.traverse_ = function(traversalFunc, opt_startNode, opt_endNode) {
    var endNode, node, _results;
    node = opt_startNode ? opt_startNode : this.root_;
    endNode = opt_endNode ? opt_endNode : null;
    _results = [];
    while (node && node !== endNode) {
      _results.push(node = traversalFunc.call(this, node));
    }
    return _results;
  };

  AvlTree.prototype.balance_ = function(node) {
    return this.traverse_(function(node) {
      var lh, rh;
      lh = node.left ? node.left.height : 0;
      rh = node.right ? node.right.height : 0;
      if (lh - rh > 1) {
        if (node.left.right && (!node.left.left || node.left.left.height < node.left.right.height)) {
          this.leftRotate_(node.left);
        }
        this.rightRotate_(node);
      } else if (rh - lh > 1) {
        if (node.right.left && (!node.right.right || node.right.right.height < node.right.left.height)) {
          this.rightRotate_(node.right);
        }
        this.leftRotate_(node);
      }
      lh = node.left ? node.left.height : 0;
      rh = node.right ? node.right.height : 0;
      node.height = Math.max(lh, rh) + 1;
      return node.parent;
    }, node);
  };

  AvlTree.prototype.leftRotate_ = function(node) {
    var temp;
    if (node.isLeftChild()) {
      node.parent.left = node.right;
      node.right.parent = node.parent;
    } else if (node.isRightChild()) {
      node.parent.right = node.right;
      node.right.parent = node.parent;
    } else {
      this.root_ = node.right;
      this.root_.parent = null;
    }
    temp = node.right;
    node.right = node.right.left;
    if (node.right !== null) node.right.parent = node;
    temp.left = node;
    return node.parent = temp;
  };

  AvlTree.prototype.rightRotate_ = function(node) {
    var temp;
    if (node.isLeftChild()) {
      node.parent.left = node.left;
      node.left.parent = node.parent;
    } else if (node.isRightChild()) {
      node.parent.right = node.left;
      node.left.parent = node.parent;
    } else {
      this.root_ = node.left;
      this.root_.parent = null;
    }
    temp = node.left;
    node.left = node.left.right;
    if (node.left !== null) node.left.parent = node;
    temp.right = node;
    return node.parent = temp;
  };

  AvlTree.prototype.removeNode_ = function(node) {
    var b, r;
    if (node.left !== null || node.right !== null) {
      b = null;
      r = null;
      if (node.left !== null) {
        r = this.getMaxNode_(node.left);
        if (r !== node.left) {
          r.parent.right = r.left;
          if (r.left) r.left.parent = r.parent;
          r.left = node.left;
          r.left.parent = r;
          b = r.parent;
        }
        r.parent = node.parent;
        r.right = node.right;
        if (r.right) r.right.parent = r;
        if (node === this.maxNode_) this.maxNode_ = r;
      } else {
        r = this.getMinNode_(node.right);
        if (r !== node.right) {
          r.parent.left = r.right;
          if (r.right) r.right.parent = r.parent;
          r.right = node.right;
          r.right.parent = r;
          b = r.parent;
        }
        r.parent = node.parent;
        r.left = node.left;
        if (r.left) r.left.parent = r;
        if (node === this.minNode_) this.minNode_ = r;
      }
      if (node.isLeftChild()) {
        node.parent.left = r;
      } else if (node.isRightChild()) {
        node.parent.right = r;
      } else {
        this.root_ = r;
      }
      return this.balance_(b ? b : r);
    } else {
      if (node.isLeftChild()) {
        this.special = 1;
        node.parent.left = null;
        if (node === this.minNode_) this.minNode_ = node.parent;
        return this.balance_(node.parent);
      } else if (node.isRightChild()) {
        node.parent.right = null;
        if (node === this.maxNode_) this.maxNode_ = node.parent;
        return this.balance_(node.parent);
      } else {
        return this.clear();
      }
    }
  };

  AvlTree.prototype.getMinNode_ = function(opt_rootNode) {
    var minNode;
    if (!opt_rootNode) return this.minNode_;
    minNode = opt_rootNode;
    this.traverse_(function(node) {
      var retNode;
      retNode = null;
      if (node.left) {
        minNode = node.left;
        retNode = node.left;
      }
      return retNode;
    }, opt_rootNode);
    return minNode;
  };

  AvlTree.prototype.getMaxNode_ = function(opt_rootNode) {
    var maxNode;
    if (!opt_rootNode) return this.maxNode_;
    maxNode = opt_rootNode;
    this.traverse_(function(node) {
      var retNode;
      retNode = null;
      if (node.right) {
        maxNode = node.right;
        retNode = node.right;
      }
      return retNode;
    }, opt_rootNode);
    return maxNode;
  };

  Node = (function() {

    function Node(value, parent) {
      this.value = value;
      this.parent = parent;
    }

    Node.prototype.left = null;

    Node.prototype.right = null;

    Node.prototype.height = 0;

    Node.prototype.isRightChild = function() {
      return !!this.parent && this.parent.right === this;
    };

    Node.prototype.isLeftChild = function() {
      return !!this.parent && this.parent.left === this;
    };

    return Node;

  })();

  return AvlTree;

})();
