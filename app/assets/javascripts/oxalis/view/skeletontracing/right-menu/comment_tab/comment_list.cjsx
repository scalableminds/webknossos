_               = require("lodash")
Utils           = require("libs/utils")
React           = require("react")
ReactDOM        = require("react-dom")
TreeCommentList = require("./tree_comment_list")


CommentList = React.createClass(

  render : ->

    return null unless @state.data.length

    # create comment lists grouped by trees
    commentAndTreeNodes = _.map(@state.data, (tree) =>

      # do not render tree if it has no comments
      return null if not tree.comments.length

      # sort comments in place
      tree.comments.sort(Utils.compareBy("node", @state.isSortedAscending))

      # one tree and its comments
      return (
        <TreeCommentList
          key={tree.treeId}
          treeId={tree.treeId}
          treeName={tree.name}
          comments={tree.comments}
          activeNodeId={@state.activeNodeId}
          activeTreeId={@state.activeTreeId}
          onNewActiveNode={@props.onNewActiveNode}
        />
      )
    )

    # the whole comment list
    return (
      <div className="commentList">
        {commentAndTreeNodes}
      </div>
    )


  getInitialState : ->

    return {
      data : []
      activeNodeId : 0
      isSortedAscending : true
    }

)

module.exports = CommentList
