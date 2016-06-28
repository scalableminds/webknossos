React           = require("react")
ReactDOM        = require("react-dom")
TreeCommentList = require("./tree_comment_list")


CommentList = React.createClass(

  render : ->

    return null unless @state.data.length

    # group comments by treeId
    groupedComments = @state.data.groupBy( (comment) -> comment.get("treeId") )

    # create comment lists grouped by trees
    commentAndTreeNodes = _.map(groupedComments, (comments, treeId) =>

      # one tree and its comments
      return (
        <TreeCommentList
          key={treeId}
          treeId={treeId}
          comments={comments}
          activeNodeId={@state.activeNodeId}
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
