package assistantturns

import (
	"encoding/json"
	"strings"
)

// Workspace conversation partitions are not canvas project ids.
const (
	WorkspaceAgentConversationID = "workspace-agent"
	WorkspaceChatConversationID  = "workspace-chat"
)

func IsWorkspaceAgentConversation(id string) bool {
	return strings.TrimSpace(id) == WorkspaceAgentConversationID
}

func IsWorkspaceChatConversation(id string) bool {
	return strings.TrimSpace(id) == WorkspaceChatConversationID
}

func IsWorkspaceConversation(id string) bool {
	return IsWorkspaceAgentConversation(id) || IsWorkspaceChatConversation(id)
}

func WorkspaceConversationDocument(id string) json.RawMessage {
	key := WorkspaceAgentConversationID
	if IsWorkspaceChatConversation(id) {
		key = WorkspaceChatConversationID
	}
	return json.RawMessage(`{"id":"` + key + `","revision":0,"nodes":[],"connections":[]}`)
}

func WorkspaceAgentDocument() json.RawMessage {
	return WorkspaceConversationDocument(WorkspaceAgentConversationID)
}
