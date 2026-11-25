package generation

import (
	"context"
	"strings"

	"infinite-canvas/backend/internal/model"
)

func MediaHydrationPolicyFor(ctx context.Context, input Input) MediaHydrationPolicy {
	policy := MediaHydrationPolicy{PreferURL: PrefersMediaURLs(input.Config.InterfaceType, input)}
	if adapter, ok := ProtocolAdapterForContext(ctx, input.Config.InterfaceType); ok {
		policy.RequireURL = adapter.Metadata().RequiresPublicMediaURLs
		policy.PreferURL = policy.PreferURL || policy.RequireURL
	}
	if input.Mode == "image" && input.Mask != nil {
		policy.RequireURL = false
		policy.PreferURL = false
	}
	return policy
}

// PrefersMediaURLs lists protocols that accept remote URLs. Multipart/byte
// protocols keep the byte path so a smaller download cannot change the request.
func PrefersMediaURLs(interfaceType string, input Input) bool {
	if input.Mode == "image" && input.Mask != nil {
		return false
	}
	switch strings.TrimSpace(interfaceType) {
	case string(model.ChannelInterfaceChatCompletion), string(model.ChannelInterfaceOpenAIResponse), string(model.ChannelInterfaceClaudeAPI),
		string(model.ChannelInterfaceGrokImage), string(model.ChannelInterfaceVolcengineArkImage), string(model.ChannelInterfaceVolcengineArkAgentPlanImage):
		return true
	}
	return false
}
