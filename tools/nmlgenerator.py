#! /usr/bin/env python

import sys
import argparse

class NMLGenerator(object):


  def __init__(self, nodes_per_tree=1, trees=1, include_comments=False):

    self.nodes_per_tree = nodes_per_tree
    self.trees = trees
    self.include_comments = include_comments


  def print_nml(self):

    print '<things>'
    self.print_parameters()
    self.print_trees()
    self.print_comments()
    print '</things>'


  def print_parameters(self):

    print '  <parameters>'
    print '    <experiment name="2012-09-28_ex145_07x2"/>'
    print '    <scale x="16.5" y="16.5" z="25.0"/>'
    print '    <offset x="0" y="0" z="0"/>'
    print '    <time ms="1395338383400"/>'
    print '    <activeNode id="1"/>'
    print '    <editPosition x="107" y="77" z="0"/>'
    print '  </parameters>'


  def print_trees(self):

    node_id_count = 1
    for tree_id in range(1, self.trees + 1):
      print '  <thing id="%d" color.r="1.0" color.g="0.0" color.b="0.0" color.a="1.0" name="Tree00%d">' % (tree_id, tree_id)
      print '    <nodes>'
      for node_id in range(node_id_count, node_id_count + self.nodes_per_tree):
        print '      <node '
        print '        id="%d" radius="165.0" x="%d" y="%d" z="%d"' % (node_id, node_id, node_id, tree_id)
        print '        inVp="0" inMag="0" bitDepth="8" interpolation="false" time="1395338380800">'
        print '      </node>'
      print '    </nodes>'
      print '    <edges>'
      for node_id in range(node_id_count + 1, node_id_count + self.nodes_per_tree):
        print '      <edge source="%d" target="%d"/>' % (node_id - 1, node_id)
      print '    </edges>'
      print '  </thing>'
      node_id_count += self.nodes_per_tree


  def print_comments(self):

    print '  <comments>'
    if self.include_comments:
      for node_id in range(1, self.trees * self.nodes_per_tree + 1):
        print '    <comment node="%d" content="Node %d"/>' % (node_id, node_id)
    print '  </comments>'


parser = argparse.ArgumentParser(description='Print an NML file.')
parser.add_argument('nodes_per_tree', type=int, help='Number of nodes per tree')
parser.add_argument('trees', type=int, help='Number of trees', default=1, nargs='?')
parser.add_argument('--comments', dest='include_comments', action='store_const',
                  const=True, default=False, help='Include comments')
args = parser.parse_args()

NMLGenerator(args.nodes_per_tree, args.trees, args.include_comments).print_nml()
