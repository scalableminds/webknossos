React      = require("react")
ReactDOM   = require("react-dom")
Comment    = require("./comment_list_item_view")


CommentList = React.createClass(

  render : ->

    return null unless @state.data.length

    activeNodeId = @state.activeNodeId

    # group comments by treeId
    groupedComments = @state.data.groupBy( (comment) -> comment.get("treeId") )

    # create comment list grouped by trees
    commentAndTreeNodes = _.map(groupedComments, (comments, treeId) =>

      commentNodes = comments.map( (comment) =>

        # one comment
        nodeId = comment.get("node")
        return (
          <Comment
            key={nodeId}
            model={comment}
            isActive={nodeId == activeNodeId}
            onNewActiveNode={@props.onNewActiveNode}
          />
        )
      )

      # one tree and its comments
      return (
        <div key={treeId}>
          <li>
            <i className="fa fa-tree"></i>
            {treeId}
          </li>
          {commentNodes}
        </div>
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
