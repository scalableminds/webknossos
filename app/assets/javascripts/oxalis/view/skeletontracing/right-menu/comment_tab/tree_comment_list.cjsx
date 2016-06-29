React      = require("react")
ReactDOM   = require("react-dom")
Comment    = require("./comment")


TreeCommentList = React.createClass(

  render : ->

    # find out whether the tree contains the activeNode regardless of whether
    # it is collapsed or not
    containsActiveNode = _.findIndex(@props.comments, (comment) =>
      return comment.get("node") == @props.activeNodeId
    ) > -1

    # don't render the comment nodes if the tree is collapsed
    commentNodes = if not @state.collapsed then @props.comments.map( (comment) =>
      nodeId = comment.get("node")
      return (
        <Comment
          key={nodeId}
          model={comment}
          isActive={nodeId == @props.activeNodeId}
          onNewActiveNode={@props.onNewActiveNode}
        />
      )
    ) else null

    icon = if @state.collapsed then "fa-chevron-right" else "fa-chevron-down"

    # one tree and its comments
    return (
      <div>
        <li className={if containsActiveNode then "bold" else ""}>
          <i className={"fa fa-fw " + icon} onClick={@handleClick}></i>
          {@props.treeId}
        </li>
        {commentNodes}
      </div>
    )


  handleClick : ->

    @setState({ collapsed : !@state.collapsed })


  getInitialState : ->

    return { collapsed : false }
)

module.exports = TreeCommentList
