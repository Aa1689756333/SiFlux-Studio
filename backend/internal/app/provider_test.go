package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/prompts"
	"infinite-canvas/backend/internal/protocol"
)

const testReferenceImageDataURL = "data:image/png;base64,aGVsbG8="

const testGeminiReferenceImageDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

func TestProviderMediaHydrationPolicyPrefersObjectURLs(t *testing.T) {
	ctx := withProtocolRegistry(context.Background(), loadOfficialFallbackRegistry())
	prefer := providerMediaHydrationPolicyFor(ctx, canvasGenerationInput{Config: providerConfig{InterfaceType: string(model.ChannelInterfaceGrokImage)}})
	if prefer.RequireURL || !prefer.PreferURL {
		t.Fatalf("grok image policy = %#v", prefer)
	}
	required := providerMediaHydrationPolicyFor(ctx, canvasGenerationInput{Config: providerConfig{InterfaceType: "dashscope-wanx-image"}})
	if !required.RequireURL || !required.PreferURL {
		t.Fatalf("wanx image policy = %#v", required)
	}
	bytesOnly := providerMediaHydrationPolicyFor(ctx, canvasGenerationInput{Config: providerConfig{InterfaceType: string(model.ChannelInterfaceGeminiImage)}})
	if bytesOnly.RequireURL || bytesOnly.PreferURL {
		t.Fatalf("gemini image policy = %#v", bytesOnly)
	}
	masked := providerMediaHydrationPolicyFor(ctx, canvasGenerationInput{Config: providerConfig{InterfaceType: string(model.ChannelInterfaceOpenAIImage)}, Mask: &providerMedia{ID: "mask"}})
	if masked.RequireURL || masked.PreferURL {
		t.Fatalf("openai mask policy = %#v", masked)
	}
	if resourceUsesObjectStorage(&model.Resource{Provider: "aliyun"}) != true {
		t.Fatal("aliyun should use object storage URLs")
	}
	if resourceUsesObjectStorage(&model.Resource{Provider: "tencent"}) != true || resourceUsesObjectStorage(&model.Resource{Provider: "qiniu"}) != true || resourceUsesObjectStorage(&model.Resource{Provider: "s3"}) != true {
		t.Fatal("cos/kodo/s3 should use object storage URLs")
	}
	if resourceUsesObjectStorage(&model.Resource{Provider: "local"}) {
		t.Fatal("local resources should fall back to protocol-compatible bytes")
	}
}

func TestLocalProviderConfigRejectsHostedChannelSelection(t *testing.T) {
	service := &Service{mode: serviceModeLocal, localResourceStorage: true}
	if _, err := service.resolveProviderConfig(providerConfig{ChannelID: "hosted-channel", Model: "model"}); err == nil {
		t.Fatal("local provider config accepted a hosted channel selection")
	}
}

func TestProviderRequestErrorDetails(t *testing.T) {
	tests := []struct {
		name string
		err  error
		code string
		text string
	}{
		{name: "cancelled", err: context.Canceled, code: "request_cancelled", text: "任务取消，中断上游请求"},
		{name: "timeout", err: context.DeadlineExceeded, code: "upstream_timeout", text: "等待上游响应超时"},
		{name: "network error", err: errors.New("dial tcp: connection refused"), text: "dial tcp: connection refused"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code, text := providerRequestErrorDetails(tt.err)
			if code != tt.code || text != tt.text {
				t.Fatalf("providerRequestErrorDetails() = (%q, %q), want (%q, %q)", code, text, tt.code, tt.text)
			}
		})
	}
}

func TestPostJSONRejectsUnserializableBodyBeforeRequest(t *testing.T) {
	err := postJSON(context.Background(), providerConfig{BaseURL: "http://127.0.0.1:1"}, "/should-not-run", map[string]any{
		"invalid": make(chan int),
	}, &map[string]any{})
	if err == nil || !strings.Contains(err.Error(), "序列化上游请求失败") {
		t.Fatalf("postJSON() error = %v, want serialization error", err)
	}
}

func TestChannelAPIURLNormalizesConfiguredVersionPrefix(t *testing.T) {
	tests := []struct {
		name string
		base string
		path string
		want string
	}{
		{name: "host", base: "http://provider.test:8000", path: "/chat/completions", want: "http://provider.test:8000/v1/chat/completions"},
		{name: "host slash", base: "http://provider.test:8000/", path: "/chat/completions", want: "http://provider.test:8000/v1/chat/completions"},
		{name: "v1", base: "http://provider.test:8000/v1", path: "/chat/completions", want: "http://provider.test:8000/v1/chat/completions"},
		{name: "v1 slash", base: "http://provider.test:8000/v1/", path: "/chat/completions", want: "http://provider.test:8000/v1/chat/completions"},
		{name: "path carries v1beta", base: "http://provider.test:8000", path: "/v1beta/models/model", want: "http://provider.test:8000/v1beta/models/model"},
		{name: "same v1beta is not duplicated", base: "http://provider.test:8000/v1beta", path: "/v1beta/models/model", want: "http://provider.test:8000/v1beta/models/model"},
		{name: "path carries v2", base: "http://provider.test:8000/v1", path: "/v2/tasks", want: "http://provider.test:8000/v2/tasks"},
		{name: "ark v3", base: "https://ark.example.com/api/v3", path: "/images/generations", want: "https://ark.example.com/api/v3/images/generations"},
		{name: "ark v3 chat", base: "https://ark.example.com/api/v3", path: "/chat/completions", want: "https://ark.example.com/api/v3/chat/completions"},
		{name: "ark v3 responses", base: "https://ark.example.com/api/v3", path: "/responses", want: "https://ark.example.com/api/v3/responses"},
		{name: "path carries ark v3", base: "https://ark.example.com", path: "/api/v3/images/generations", want: "https://ark.example.com/api/v3/images/generations"},
		{name: "path carries autodl api v1", base: "https://autodl.art", path: "/api/v1/comfyui/comfyui_workflow/workflow-1", want: "https://autodl.art/api/v1/comfyui/comfyui_workflow/workflow-1"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ChannelAPIURL(tt.base, tt.path); got != tt.want {
				t.Fatalf("ChannelAPIURL(%q, %q) = %q, want %q", tt.base, tt.path, got, tt.want)
			}
		})
	}
}

func TestChannelAPIURLForProtocolUsesGeminiDefault(t *testing.T) {
	if got := ChannelAPIURLForProtocol("https://generativelanguage.googleapis.com", "/models/gemini:generateContent", model.ChannelInterfaceGeminiVeo); got != "https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent" {
		t.Fatalf("Gemini URL = %q", got)
	}
}

func TestProtocolRequestURLCanResolveSameOriginRootPath(t *testing.T) {
	got, err := protocolRequestURL("https://apihub.agnes-ai.com/v1", protocol.RequestSpec{Path: "/agnesapi?video_id=video-1&model_name=agnes-video-2.5", OriginPath: true})
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://apihub.agnes-ai.com/agnesapi?video_id=video-1&model_name=agnes-video-2.5" {
		t.Fatalf("root path URL = %q", got)
	}
}

func TestSystemChannelIDFromBaseURLSupportsShortAndLegacyProxyPaths(t *testing.T) {
	for _, test := range []struct{ base, want string }{
		{base: "/api/channel-1", want: "channel-1"},
		{base: "/api/ai/system/channel-2", want: "channel-2"},
		{base: "https://canvas.example.com/api/channel-3", want: "channel-3"},
	} {
		if got := systemChannelIDFromBaseURL(test.base); got != test.want {
			t.Fatalf("systemChannelIDFromBaseURL(%q) = %q, want %q", test.base, got, test.want)
		}
	}
}

func TestWriteMediaPartSanitizesFilenameAndSetsMimeType(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writeMediaPart(writer, "image", providerMedia{ID: "image-1", Name: "提示词\n带换行.png", Type: "image/png", DataURL: testReferenceImageDataURL}); err != nil {
		t.Fatalf("writeMediaPart() error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("multipart.Writer.Close() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "http://example.test", bytes.NewReader(body.Bytes()))
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := request.ParseMultipartForm(1 << 20); err != nil {
		t.Fatalf("ParseMultipartForm() error = %v", err)
	}
	files := request.MultipartForm.File["image"]
	if len(files) != 1 {
		t.Fatalf("image files = %d, want 1", len(files))
	}
	file := files[0]
	if file.Filename != "reference-image-1.png" || strings.ContainsAny(file.Filename, "\r\n") {
		t.Fatalf("filename = %q", file.Filename)
	}
	if got := file.Header.Get("Content-Type"); got != "image/png" {
		t.Fatalf("part Content-Type = %q, want image/png", got)
	}
	opened, err := file.Open()
	if err != nil {
		t.Fatalf("file.Open() error = %v", err)
	}
	defer opened.Close()
	data, err := io.ReadAll(opened)
	if err != nil {
		t.Fatalf("io.ReadAll() error = %v", err)
	}
	if string(data) != "hello" {
		t.Fatalf("file data = %q, want hello", data)
	}
}

func TestParseTextEventStreamSupportsResponsesAndChat(t *testing.T) {
	responses := []byte(`event: response.output_text.delta
data: {"delta":"{\"title\":\"分镜\""}

event: response.output_text.delta
data: {"delta":"}"}

data: [DONE]

`)
	if got, err := parseTextEventStream(responses, "responses"); err != nil || got != `{"title":"分镜"}` {
		t.Fatalf("Responses stream = %q, err = %v", got, err)
	}

	chat := []byte(`data: {"choices":[{"delta":{"content":"第一镜"}}]}

data: {"choices":[{"delta":{"content":"：远景"}}]}

data: [DONE]

`)
	if got, err := parseTextEventStream(chat, "chat-completion"); err != nil || got != "第一镜：远景" {
		t.Fatalf("Chat stream = %q, err = %v", got, err)
	}

	claude := []byte(`event: content_block_delta
data: {"delta":{"type":"text_delta","text":"第一镜"}}

event: content_block_delta
data: {"delta":{"type":"text_delta","text":"：远景"}}

`)
	if got, err := parseTextEventStream(claude, "claude-api"); err != nil || got != "第一镜：远景" {
		t.Fatalf("Claude stream = %q, err = %v", got, err)
	}
}

func TestParseAgentToolPayloadSupportsChatCompletions(t *testing.T) {
	result, err := parseAgentToolPayload(map[string]interface{}{
		"choices": []interface{}{map[string]interface{}{
			"message": map[string]interface{}{
				"content": "准备读取画布",
				"tool_calls": []interface{}{map[string]interface{}{
					"id":       "call-1",
					"function": map[string]interface{}{"name": "canvas_get_state", "arguments": `{}`},
				}},
			},
		}},
	}, "chat-completion")
	if err != nil {
		t.Fatalf("parseAgentToolPayload() error = %v", err)
	}
	if result["text"] != "准备读取画布" {
		t.Fatalf("text = %v", result["text"])
	}
	calls, _ := result["toolCalls"].([]interface{})
	if len(calls) != 1 {
		t.Fatalf("toolCalls = %#v", result["toolCalls"])
	}
	call, _ := calls[0].(map[string]interface{})
	function, _ := call["function"].(map[string]interface{})
	if call["id"] != "call-1" || function["name"] != "canvas_get_state" || function["arguments"] != `{}` {
		t.Fatalf("tool call = %#v", call)
	}
}

func TestParseAgentToolPayloadSupportsResponses(t *testing.T) {
	result, err := parseAgentToolPayload(map[string]interface{}{
		"output": []interface{}{
			map[string]interface{}{"type": "reasoning", "summary": []interface{}{map[string]interface{}{"type": "summary_text", "text": "先读取画布，再决定操作"}}},
			map[string]interface{}{"type": "message", "content": []interface{}{map[string]interface{}{"type": "output_text", "text": "开始操作"}}},
			map[string]interface{}{"type": "function_call", "call_id": "call-2", "name": "canvas_apply_ops", "arguments": `{"ops":[]}`},
		},
	}, "responses")
	if err != nil {
		t.Fatalf("parseAgentToolPayload() error = %v", err)
	}
	if result["text"] != "开始操作" {
		t.Fatalf("text = %v", result["text"])
	}
	if result["reasoning"] != "先读取画布，再决定操作" {
		t.Fatalf("reasoning = %v", result["reasoning"])
	}
	calls, _ := result["toolCalls"].([]interface{})
	if len(calls) != 1 {
		t.Fatalf("toolCalls = %#v", result["toolCalls"])
	}
	call, _ := calls[0].(map[string]interface{})
	function, _ := call["function"].(map[string]interface{})
	if call["id"] != "call-2" || function["name"] != "canvas_apply_ops" || function["arguments"] != `{"ops":[]}` {
		t.Fatalf("tool call = %#v", call)
	}
}

func TestParseAgentToolPayloadSupportsClaude(t *testing.T) {
	result, err := parseAgentToolPayload(map[string]interface{}{
		"content": []interface{}{
			map[string]interface{}{"type": "text", "text": "开始操作"},
			map[string]interface{}{"type": "tool_use", "id": "call-3", "name": "canvas_get_state", "input": map[string]interface{}{}},
		},
	}, "claude-api")
	if err != nil {
		t.Fatalf("parseAgentToolPayload() error = %v", err)
	}
	if result["text"] != "开始操作" {
		t.Fatalf("text = %v", result["text"])
	}
	calls, _ := result["toolCalls"].([]interface{})
	if len(calls) != 1 {
		t.Fatalf("toolCalls = %#v", result["toolCalls"])
	}
	call, _ := calls[0].(map[string]interface{})
	function, _ := call["function"].(map[string]interface{})
	if call["id"] != "call-3" || function["name"] != "canvas_get_state" || function["arguments"] != "{}" {
		t.Fatalf("tool call = %#v", call)
	}
}

func TestClaudeAgentBodyMapsOpenAIStyleTools(t *testing.T) {
	body := claudeAgentBody(map[string]interface{}{
		"messages": []interface{}{
			map[string]interface{}{"role": "system", "content": "You are concise."},
			map[string]interface{}{"role": "user", "content": "读取画布"},
			map[string]interface{}{"role": "assistant", "content": nil, "tool_calls": []interface{}{map[string]interface{}{
				"id": "call-4", "function": map[string]interface{}{"name": "canvas_get_state", "arguments": `{}`},
			}}},
			map[string]interface{}{"role": "tool", "tool_call_id": "call-4", "content": `{"nodes":[]}`},
		},
		"tools": []interface{}{map[string]interface{}{"type": "function", "function": map[string]interface{}{
			"name": "canvas_get_state", "description": "读取画布", "parameters": map[string]interface{}{"type": "object"},
		}}},
		"tool_choice": "required",
	})
	systemBlocks, _ := body["system"].([]interface{})
	if len(systemBlocks) != 1 || body["max_tokens"] != 4096 {
		t.Fatalf("body = %#v", body)
	}
	system, _ := systemBlocks[0].(map[string]interface{})
	if system["text"] != "You are concise." {
		t.Fatalf("system = %#v", system)
	}
	if cache, _ := system["cache_control"].(map[string]interface{}); cache["type"] != "ephemeral" {
		t.Fatalf("system cache_control = %#v", system["cache_control"])
	}
	messages, _ := body["messages"].([]interface{})
	if len(messages) != 3 {
		t.Fatalf("messages = %#v", messages)
	}
	tools, _ := body["tools"].([]interface{})
	tool, _ := tools[0].(map[string]interface{})
	if tool["name"] != "canvas_get_state" || body["tool_choice"].(map[string]interface{})["type"] != "any" {
		t.Fatalf("tools/choice = %#v / %#v", body["tools"], body["tool_choice"])
	}
	if cache, _ := tool["cache_control"].(map[string]interface{}); cache["type"] != "ephemeral" {
		t.Fatalf("tool cache_control = %#v", tool["cache_control"])
	}
}

func TestCanonicalAgentBodiesPreserveAssistantToolCalls(t *testing.T) {
	request := canonicalAgentRequest{
		Messages: []map[string]any{
			{"role": "user", "content": "读取画布"},
			{"role": "assistant", "content": "我先查看当前内容。", "tool_calls": []cloudAgentCall{{
				ID: "call-5",
				Function: struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				}{Name: "canvas_get_state", Arguments: `{}`},
			}}},
			{"role": "tool", "tool_call_id": "call-5", "content": `{"nodes":[]}`},
		},
	}

	chat := canonicalAgentChatBody(&request, false)
	chatMessages, _ := chat["messages"].([]interface{})
	assistant, _ := chatMessages[1].(map[string]interface{})
	if assistant["content"] != "我先查看当前内容。" || len(canonicalAgentToolCalls(assistant["tool_calls"])) != 1 {
		t.Fatalf("chat assistant message lost text or tool call: %#v", assistant)
	}
	// Assert the actual JSON shape, not a helper that could repair missing fields.
	raw, err := json.Marshal(chat)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]interface{}
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}
	wireAssistant := wire["messages"].([]interface{})[1].(map[string]interface{})
	wireCall := wireAssistant["tool_calls"].([]interface{})[0].(map[string]interface{})
	if wireCall["type"] != "function" || wireCall["id"] != "call-5" {
		t.Fatalf("chat tool call missing wire fields: %#v", wireCall)
	}
	function := wireCall["function"].(map[string]interface{})
	if function["name"] != "canvas_get_state" || function["arguments"] != "{}" {
		t.Fatalf("chat tool call changed function: %#v", function)
	}
	claude := claudeAgentBody(canonicalAgentChatBody(&request, true))
	claudeAssistant := claude["messages"].([]interface{})[1].(map[string]interface{})
	blocks, ok := claudeAssistant["content"].([]interface{})
	if !ok || len(blocks) != 1 || blocks[0].(map[string]interface{})["type"] != "tool_use" {
		t.Fatalf("claude assistant lost tool use: %#v", claudeAssistant)
	}

	responses := canonicalAgentResponsesBody(&request)
	responseInput, _ := responses["input"].([]interface{})
	if len(responseInput) != 4 {
		t.Fatalf("responses input = %#v", responseInput)
	}
	functionCall, _ := responseInput[2].(map[string]interface{})
	if functionCall["type"] != "function_call" || functionCall["name"] != "canvas_get_state" {
		t.Fatalf("responses function call = %#v", functionCall)
	}
}

func TestRunAgentToolTaskOmitsToolChoiceBeforeThinkingRequest(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	forcedChoices := []interface{}{
		"required",
		map[string]interface{}{"type": "function", "function": map[string]interface{}{"name": "canvas_get_state"}},
		"auto",
	}
	for _, forcedChoice := range forcedChoices {
		t.Run(fmt.Sprint(forcedChoice), func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				var body map[string]interface{}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatalf("decode request: %v", err)
				}
				if _, exists := body["tool_choice"]; exists {
					t.Errorf("thinking request retained tool_choice: %#v", body["tool_choice"])
				}
				if body["reasoning_effort"] != "medium" {
					t.Errorf("thinking was not forwarded: %#v", body["reasoning_effort"])
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"完成","tool_calls":[]}}]}`))
			}))

			result, err := runAgentToolTask(context.Background(), canvasGenerationInput{
				Config:        providerConfig{BaseURL: server.URL, APIKey: "key", Model: "thinking-model"},
				TextOptions:   canvasTextOptions{Thinking: true},
				AgentRequests: &agentToolRequests{ChatCompletion: map[string]interface{}{"messages": []interface{}{}, "tool_choice": forcedChoice}},
			})
			server.Close()
			if err != nil {
				t.Fatalf("runAgentToolTask() error = %v", err)
			}
			if result["text"] != "完成" || requests != 1 {
				t.Fatalf("result/requests = %#v / %d", result, requests)
			}
		})
	}
}

func TestRunAgentToolTaskOmitsExplicitAutomaticToolChoice(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if _, exists := body["tool_choice"]; exists {
			t.Errorf("automatic choice should use the protocol default: %#v", body["tool_choice"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"完成","tool_calls":[]}}]}`))
	}))
	defer server.Close()

	result, err := runAgentToolTask(context.Background(), canvasGenerationInput{
		Config:        providerConfig{BaseURL: server.URL, APIKey: "key", Model: "model"},
		AgentRequests: &agentToolRequests{ChatCompletion: map[string]interface{}{"messages": []interface{}{}, "tool_choice": "auto"}},
	})
	if err != nil || result["text"] != "完成" {
		t.Fatalf("result = %#v, err = %v", result, err)
	}
}

func TestRunDeclarativeAgentTaskOmitsToolChoiceBeforeThinkingRequest(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if _, exists := body["tool_choice"]; exists {
			t.Errorf("declarative thinking request retained tool_choice: %#v", body["tool_choice"])
		}
		if body["reasoning_effort"] != "medium" {
			t.Errorf("thinking was not forwarded: %#v", body["reasoning_effort"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"完成","tool_calls":[]}}]}`))
	}))
	defer server.Close()

	adapter, err := protocol.LoadManifest([]byte(`{
		"apiVersion":"siflux.plugin/v1",
		"id":"chat-completion","version":"1.0.0","name":"Chat Completion Test","author":"Test","documentation":"# Test",
		"contributes":{"providers":[{"id":"chat-completion","label":"Chat Completion Test","capabilities":["text"],"scopes":["agent"],
		"create":{"method":"POST","path":"/create"},
		"agent":{"method":"POST","path":"/chat/completions","fields":{"model":"request.model","messages":"request.extra.agent.chatCompletion.messages","tools":"request.extra.agent.chatCompletion.tools","tool_choice":"request.extra.agent.chatCompletion.tool_choice"}},
		"agentResponse":{"textPaths":["choices.0.message.content"],"toolCallsPath":"choices.0.message.tool_calls","toolCallIdPaths":["id"],"toolCallNamePaths":["function.name"],"toolCallArgumentsPaths":["function.arguments"]},"response":{}}]}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	registry, err := protocol.NewRegistry(adapter)
	if err != nil {
		t.Fatal(err)
	}
	result, err := runAgentToolTask(withProtocolRegistry(context.Background(), registry), canvasGenerationInput{
		Config:      providerConfig{BaseURL: server.URL, APIKey: "key", Model: "thinking-model", InterfaceType: "chat-completion"},
		TextOptions: canvasTextOptions{Thinking: true},
		AgentRequests: &agentToolRequests{ChatCompletion: map[string]interface{}{
			"messages": []interface{}{}, "tools": []interface{}{}, "tool_choice": "required",
		}},
	})
	if err != nil {
		t.Fatalf("runAgentToolTask() error = %v", err)
	}
	if result["text"] != "完成" {
		t.Fatalf("result = %#v", result)
	}
}

func TestRunAgentToolTaskFallsBackToolChoiceForImplicitThinking(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var choices []interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		choice, exists := body["tool_choice"]
		if _, exists := body["reasoning_effort"]; exists {
			t.Errorf("undeclared thinking should not add reasoning options: %#v", body["reasoning_effort"])
		}
		if exists {
			choices = append(choices, choice)
		} else {
			choices = append(choices, nil)
		}
		w.Header().Set("Content-Type", "application/json")
		if len(choices) < 3 {
			_, _ = w.Write([]byte(`{"error":{"message":"tool_choice is incompatible with thinking mode"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"完成","tool_calls":[]}}]}`))
	}))
	defer server.Close()

	config := providerConfig{BaseURL: server.URL, APIKey: "key", Model: "thinking-model"}
	result, err := runAgentToolTask(context.Background(), canvasGenerationInput{
		Config:        config,
		AgentRequests: &agentToolRequests{ChatCompletion: map[string]interface{}{"messages": []interface{}{}, "tool_choice": "required"}},
	})
	if err != nil {
		t.Fatalf("runAgentToolTask() error = %v", err)
	}
	if result["text"] != "完成" {
		t.Fatalf("text = %v", result["text"])
	}
	if len(choices) != 3 || choices[0] != "required" || choices[1] != "auto" || choices[2] != nil {
		t.Fatalf("tool choices = %#v", choices)
	}
}

func TestPostStreamingTextSetsStreamHeaders(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Accept"); got != "text/event-stream" {
			t.Errorf("Accept = %q", got)
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		if stream, ok := body["stream"].(bool); !ok || !stream {
			t.Errorf("stream body field = %#v", body["stream"])
		}
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		_, _ = w.Write([]byte(`data: {"choices":[{"delta":{"content":"流式分镜"}}]}

data: [DONE]

`))
	}))
	defer server.Close()

	var deltas strings.Builder
	got, err := postStreamingText(context.Background(), providerConfig{BaseURL: server.URL, APIKey: "test-key"}, "/chat/completions", map[string]interface{}{"model": "test-model"}, "chat-completion", func(delta string) {
		deltas.WriteString(delta)
	})
	if err != nil || got != "流式分镜" {
		t.Fatalf("postStreamingText() = %q, err = %v", got, err)
	}
	if deltas.String() != "流式分镜" {
		t.Fatalf("stream deltas = %q", deltas.String())
	}
}

func TestTextThinkingOptionsAndReasoningParsing(t *testing.T) {
	input := canvasGenerationInput{TextOptions: canvasTextOptions{Thinking: true}}
	responsesBody := map[string]interface{}{}
	applyTextThinking(responsesBody, input, "responses")
	reasoning, _ := responsesBody["reasoning"].(map[string]interface{})
	if reasoning["effort"] != "medium" || reasoning["summary"] != "auto" {
		t.Fatalf("responses reasoning options = %#v", reasoning)
	}
	chatBody := map[string]interface{}{}
	applyTextThinking(chatBody, input, "chat-completion")
	if chatBody["reasoning_effort"] != "medium" {
		t.Fatalf("chat reasoning options = %#v", chatBody)
	}
	result, err := parseAgentToolPayload(map[string]interface{}{"choices": []interface{}{map[string]interface{}{"message": map[string]interface{}{"content": "正文", "reasoning_content": "推理摘要"}}}}, "chat-completion")
	if err != nil || result["text"] != "正文" || result["reasoning"] != "推理摘要" {
		t.Fatalf("parsed reasoning result = %#v, err = %v", result, err)
	}
}

func TestStreamingAgentParserReassemblesChatToolCallsAcrossChunks(t *testing.T) {
	var deltas strings.Builder
	parser := newStreamingAgentParser("chat-completion", func(delta string) {
		deltas.WriteString(delta)
	})
	stream := `data: {"choices":[{"delta":{"content":"准备","tool_calls":[{"index":0,"id":"call-1","function":{"name":"canvas_apply_ops","arguments":"{\"ops\":"}}]}}]}

data: {"choices":[{"delta":{"content":"执行","tool_calls":[{"index":0,"function":{"arguments":"[]}"}}]}}]}

data: [DONE]

`
	parser.Consume("text/event-stream", []byte(stream[:47]))
	parser.Consume("text/event-stream", []byte(stream[47:]))
	parser.Flush()
	result, err := parser.Result()
	if err != nil {
		t.Fatalf("streamingAgentParser.Result() error = %v", err)
	}
	if result["text"] != "准备执行" || deltas.String() != "准备执行" {
		t.Fatalf("text = %v, deltas = %q", result["text"], deltas.String())
	}
	calls, _ := result["toolCalls"].([]interface{})
	call, _ := calls[0].(map[string]interface{})
	function, _ := call["function"].(map[string]interface{})
	if call["id"] != "call-1" || function["name"] != "canvas_apply_ops" || function["arguments"] != `{"ops":[]}` {
		t.Fatalf("tool call = %#v", call)
	}
}

func TestStreamingAgentParserSeparatesResponsesReasoningFromVisibleText(t *testing.T) {
	var deltas strings.Builder
	parser := newStreamingAgentParser("responses", func(delta string) {
		deltas.WriteString(delta)
	})
	parser.Consume("text/event-stream", []byte(`event: response.reasoning_summary_text.delta
data: {"type":"response.reasoning_summary_text.delta","delta":"内部分析"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"可见回答"}

event: response.completed
data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"可见回答"}]}]}}

`))
	parser.Flush()
	result, err := parser.Result()
	if err != nil {
		t.Fatalf("streamingAgentParser.Result() error = %v", err)
	}
	if result["text"] != "可见回答" || result["reasoning"] != "内部分析" || deltas.String() != "可见回答" {
		t.Fatalf("result = %#v, deltas = %q", result, deltas.String())
	}
}

func TestStreamingAgentParserWaitsForCompleteClaudeToolJSON(t *testing.T) {
	parser := newStreamingAgentParser("claude-api", nil)
	parser.Consume("text/event-stream", []byte(`event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-2","name":"canvas_get_state","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"include\":"}}

`))
	parser.Flush()
	if _, err := parser.Result(); err == nil || !strings.Contains(err.Error(), "完整 JSON") {
		t.Fatalf("incomplete tool arguments error = %v", err)
	}
}

func TestProviderHTTPErrorWarnsAboutUncertain524Execution(t *testing.T) {
	message := (providerHTTPError{StatusCode: 524, Status: "524 A Timeout Occurred"}).Error()
	if !strings.Contains(message, "可能仍在服务端执行") || !strings.Contains(message, "不要立即重新提交") {
		t.Fatalf("providerHTTPError.Error() = %q", message)
	}
}

func TestPostJSONWithSubmissionKeyUsesStableHeaderOnly(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	const submissionKey = "02d94154-2379-5bb1-b528-57633fbb689a"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Idempotency-Key"); got != submissionKey {
			t.Errorf("Idempotency-Key = %q, want %q", got, submissionKey)
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if _, leaked := body["idempotencyKey"]; leaked {
			t.Fatalf("submission key leaked into provider body: %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"provider-video-1"}`))
	}))
	defer server.Close()

	ctx := context.WithValue(context.Background(), providerSubmissionKeyContext{}, submissionKey)
	var created map[string]interface{}
	err := postJSONWithSubmissionKey(ctx, providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key"}, "/videos", map[string]interface{}{"model": "seedance-2.0"}, &created)
	if err != nil {
		t.Fatal(err)
	}
	if created["id"] != "provider-video-1" {
		t.Fatalf("created = %#v", created)
	}
}

func TestProviderHTTPErrorDoesNotExposeResponseBody(t *testing.T) {
	message := (providerHTTPError{
		StatusCode: http.StatusBadGateway,
		Status:     "502 Bad Gateway",
		Body:       `{"error":{"message":"api-key=secret"}}`,
	}).Error()
	if strings.Contains(message, "api-key") || strings.Contains(message, "secret") || strings.Contains(message, `{"error"`) {
		t.Fatalf("providerHTTPError exposed upstream response body: %q", message)
	}
	if !strings.Contains(message, "暂时不可用") {
		t.Fatalf("providerHTTPError.Error() = %q", message)
	}
}

func TestProviderHTTPErrorExplainsPaymentRequired(t *testing.T) {
	message := (providerHTTPError{
		StatusCode: http.StatusPaymentRequired,
		Status:     "402 Payment Required",
		Body:       `{"error":{"message":"insufficient balance api-key=secret"}}`,
	}).Error()
	if !strings.Contains(message, "计费或额度") || strings.Contains(message, "账户的余额") {
		t.Fatalf("providerHTTPError.Error() = %q", message)
	}
	if strings.Contains(message, "secret") || strings.Contains(message, "api-key") {
		t.Fatalf("providerHTTPError exposed upstream response body: %q", message)
	}
}

func TestShouldFallbackTextToChatOnlyForMissingCapability(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusMethodNotAllowed, http.StatusNotImplemented} {
		if !shouldFallbackTextToChat(providerHTTPError{StatusCode: status}) {
			t.Errorf("status %d should fallback to chat completions", status)
		}
	}
	for _, status := range []int{http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout, http.StatusInternalServerError, http.StatusTooManyRequests} {
		if shouldFallbackTextToChat(providerHTTPError{StatusCode: status}) {
			t.Errorf("status %d should not fallback to chat completions", status)
		}
	}
	if shouldFallbackTextToChat(errors.New("network")) {
		t.Fatal("non-http error should not fallback")
	}
}

func TestProviderPayloadErrorMessageUsesSafeActionableCategories(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "moderation", raw: "request blocked by content policy: prompt=private", want: "内容安全审核"},
		{name: "quota", raw: "insufficient quota for api-key=secret", want: "计费或额度"},
		{name: "model access", raw: "model not found for tenant secret-id", want: "当前模型或接口不可用"},
		{name: "thinking mode rejects forced tool choice", raw: `{"error":{"message":"Thinking mode does not support this tool_choice","request_id":"secret-trace"}}`, want: "不支持强制工具调用"},
		{name: "reasoning mode rejects forced tool choice", raw: `{"error":{"message":"tool_choice=required is not supported in reasoning mode"}}`, want: "不支持强制工具调用"},
		{name: "unknown", raw: "trace_id=private internal stack", want: "生成失败"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			message := providerPayloadErrorMessage(tt.raw)
			if !strings.Contains(message, tt.want) {
				t.Fatalf("providerPayloadErrorMessage() = %q, want category %q", message, tt.want)
			}
			if strings.Contains(message, "secret") || strings.Contains(message, "private") {
				t.Fatalf("provider payload detail leaked: %q", message)
			}
		})
	}
}

func TestProviderPayloadErrorCategoryFlagsRealPersonRejection(t *testing.T) {
	raw := `{"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"The request failed because the input image 'content[1]' may contain real person. Request id: secret-trace"}}`
	message, ok := providerPayloadErrorCategory(raw)
	if !ok {
		t.Fatalf("providerPayloadErrorCategory() ok = false, want true")
	}
	if !strings.Contains(message, "真人形象") {
		t.Fatalf("providerPayloadErrorCategory() = %q, want 真人形象 category", message)
	}
	if strings.Contains(message, "secret") || strings.Contains(message, "content[1]") {
		t.Fatalf("provider payload detail leaked: %q", message)
	}
}

func TestProviderPayloadErrorCategoryReportsUnclassifiedBodies(t *testing.T) {
	for _, raw := range []string{"", "   ", "trace_id=private internal stack"} {
		if message, ok := providerPayloadErrorCategory(raw); ok {
			t.Fatalf("providerPayloadErrorCategory(%q) = %q, want no category", raw, message)
		}
	}
}

func TestProviderUserFacingErrorMessageClassifiesRejectedRequestBodies(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		body       string
		want       string
	}{
		{
			name:       "real person rejection",
			statusCode: http.StatusBadRequest,
			body:       `{"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"input image may contain real person, secret-trace"}}`,
			want:       "真人形象",
		},
		{
			name:       "moderation rejection",
			statusCode: http.StatusBadRequest,
			body:       `{"error":{"message":"request blocked by content policy, secret-trace"}}`,
			want:       "内容安全审核",
		},
		{
			name:       "unprocessable entity is classified too",
			statusCode: http.StatusUnprocessableEntity,
			body:       `{"error":{"message":"insufficient balance, secret-trace"}}`,
			want:       "计费或额度",
		},
		{
			name:       "unclassified body keeps the generic parameter hint",
			statusCode: http.StatusBadRequest,
			body:       `{"error":{"message":"trace_id=secret-trace"}}`,
			want:       "请检查模型、尺寸、时长、格式或数量",
		},
		{
			name:       "empty body keeps the generic parameter hint",
			statusCode: http.StatusBadRequest,
			body:       "",
			want:       "请检查模型、尺寸、时长、格式或数量",
		},
		{
			name:       "http 402 without body is unknown billing",
			statusCode: http.StatusPaymentRequired,
			body:       "",
			want:       "计费或额度",
		},
		{
			name:       "http 451 safety body",
			statusCode: 451,
			body:       "Your prompt or reference image was blocked by the content safety policy. Please adjust your prompt or reference image and try again.",
			want:       "内容安全审核",
		},
		{
			name:       "thinking mode rejects forced tool choice",
			statusCode: http.StatusBadRequest,
			body:       `{"error":{"message":"Thinking mode does not support this tool_choice","request_id":"secret"}}`,
			want:       "不支持强制工具调用",
		},
		{
			name:       "payment required because balance is insufficient",
			statusCode: http.StatusPaymentRequired,
			body:       `{"error":{"message":"insufficient balance, api-key=secret"}}`,
			want:       "计费或额度",
		},
		{
			name:       "payment required because subscription is missing",
			statusCode: http.StatusPaymentRequired,
			body:       `{"error":{"message":"subscription required for this model, api-key=secret"}}`,
			want:       "计费或额度",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			message := providerUserFacingErrorMessage(providerHTTPError{StatusCode: tt.statusCode, Body: tt.body})
			if !strings.Contains(message, tt.want) {
				t.Fatalf("providerUserFacingErrorMessage() = %q, want category %q", message, tt.want)
			}
			if strings.Contains(message, "secret-trace") || strings.Contains(message, `{"error"`) {
				t.Fatalf("provider response body leaked: %q", message)
			}
		})
	}
}

func TestProviderUserFacingErrorMessageKeepsUnknown402SafeAndActionable(t *testing.T) {
	message := providerUserFacingErrorMessage(providerHTTPError{
		StatusCode: http.StatusPaymentRequired,
		Body:       `{"error":{"message":"internal billing trace api-key=secret"}}`,
	})
	if !strings.Contains(message, "计费或额度") {
		t.Fatalf("providerUserFacingErrorMessage() = %q", message)
	}
	if strings.Contains(message, "secret") || strings.Contains(message, "api-key") || strings.Contains(message, "trace") {
		t.Fatalf("provider response body leaked: %q", message)
	}
}

func TestProviderUserFacingErrorMessageOnlyClassifiesValidationStatuses(t *testing.T) {
	// 鉴权失败与网关错误的正文可能是密钥诊断或代理 HTML，不参与归类。
	for _, statusCode := range []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusBadGateway} {
		message := providerUserFacingErrorMessage(providerHTTPError{
			StatusCode: statusCode,
			Body:       `{"error":{"message":"blocked by content policy, api-key=secret"}}`,
		})
		if strings.Contains(message, "安全审核") {
			t.Fatalf("status %d classified from response body: %q", statusCode, message)
		}
		if strings.Contains(message, "secret") || strings.Contains(message, "api-key") {
			t.Fatalf("status %d leaked response body: %q", statusCode, message)
		}
	}
}

func TestProviderUserFacingErrorMessageClassifiesWrappedHTTPErrors(t *testing.T) {
	wrapped := fmt.Errorf("视频任务创建失败：%w", providerHTTPError{
		StatusCode: http.StatusBadRequest,
		Body:       `{"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"may contain real person","request_id":"secret-trace"}}`,
	})
	message := providerUserFacingErrorMessage(wrapped)
	if !strings.Contains(message, "真人形象") {
		t.Fatalf("providerUserFacingErrorMessage() = %q, want 真人形象 category", message)
	}
	if strings.Contains(message, "secret-trace") || strings.Contains(message, `{"error"`) {
		t.Fatalf("provider response body leaked through wrapped error: %q", message)
	}
}

// 正文经常回显用户提示词。肖像类词汇本身不能触发真人类目，
// 否则普通的参数错误或安全审核会被误报成肖像问题。
func TestProviderPayloadErrorCategoryIgnoresEchoedPortraitWording(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{
			name: "echoed chinese portrait prompt stays a parameter error",
			raw:  `{"error":{"message":"invalid parameter: prompt=生成油画肖像"}}`,
			want: "请检查模型、尺寸、时长、格式或数量",
		},
		{
			name: "echoed english likeness prompt stays a parameter error",
			raw:  `{"error":{"message":"invalid argument: style=likeness study"}}`,
			want: "请检查模型、尺寸、时长、格式或数量",
		},
		{
			name: "moderation wins over echoed real person prompt",
			raw:  `{"error":{"message":"request blocked by content policy: prompt=real person portrait"}}`,
			want: "安全审核",
		},
		{
			name: "bare real person prose is not classified as likeness",
			raw:  `{"error":{"message":"this model does not support real people yet"}}`,
			want: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			message, ok := providerPayloadErrorCategory(tt.raw)
			if tt.want == "" {
				if ok {
					t.Fatalf("providerPayloadErrorCategory() = %q, want no category", message)
				}
				return
			}
			if !ok {
				t.Fatalf("providerPayloadErrorCategory() ok = false, want category %q", tt.want)
			}
			if strings.Contains(message, "真人形象") {
				t.Fatalf("echoed portrait wording misclassified as likeness: %q", message)
			}
			if !strings.Contains(message, tt.want) {
				t.Fatalf("providerPayloadErrorCategory() = %q, want category %q", message, tt.want)
			}
		})
	}
}

// 供应商错误码与安全审核措辞同时出现时，以更具体的错误码为准。
func TestProviderPayloadErrorCategoryPrefersProviderCodeOverModerationWording(t *testing.T) {
	raw := `{"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"blocked by content policy"}}`
	message, ok := providerPayloadErrorCategory(raw)
	if !ok || !strings.Contains(message, "真人形象") {
		t.Fatalf("providerPayloadErrorCategory() = %q, ok = %v, want 真人形象 category", message, ok)
	}
}

func TestVolcengineArkImageBodyUsesJSONReferencesAndDownscalesSize(t *testing.T) {
	body, err := volcengineArkImageBody(canvasGenerationInput{
		Prompt: "combine the references",
		Config: providerConfig{Model: "doubao-seedream-test", Size: "3840x2160", SystemPrompt: "keep the subject"},
		ReferenceImages: []providerMedia{
			{URL: "https://example.com/first.png"},
			{DataURL: testReferenceImageDataURL},
		},
	})
	if err != nil {
		t.Fatalf("volcengineArkImageBody() error = %v", err)
	}
	images, ok := body["image"].([]string)
	if !ok || len(images) != 2 || images[0] != "https://example.com/first.png" || images[1] != testReferenceImageDataURL {
		t.Fatalf("image = %#v", body["image"])
	}
	if body["prompt"] != "keep the subject\n\ncombine the references" {
		t.Fatalf("prompt = %q", body["prompt"])
	}
	if watermark, ok := body["watermark"].(bool); !ok || watermark {
		t.Fatalf("watermark = %#v, want false", body["watermark"])
	}
	if responseFormat, _ := body["response_format"].(string); responseFormat != "b64_json" {
		t.Fatalf("response_format = %#v, want b64_json", body["response_format"])
	}
	size, _ := body["size"].(string)
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		t.Fatalf("size = %q", size)
	}
	width, _ := strconv.Atoi(parts[0])
	height, _ := strconv.Atoi(parts[1])
	if width%2 != 0 || height%2 != 0 || int64(width)*int64(height) < volcengineArkImageMinPixels || int64(width)*int64(height) > volcengineArkImageMaxPixels {
		t.Fatalf("downscaled size = %q", size)
	}
}

func TestVolcengineArkImageBodyUpscalesPresetBelowMinimumPixels(t *testing.T) {
	body, err := volcengineArkImageBody(canvasGenerationInput{
		Prompt: "vertical image",
		Config: providerConfig{Model: "doubao-seedream-test", Size: "9:16"},
	})
	if err != nil {
		t.Fatalf("volcengineArkImageBody() error = %v", err)
	}
	size, _ := body["size"].(string)
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		t.Fatalf("size = %q", size)
	}
	width, _ := strconv.Atoi(parts[0])
	height, _ := strconv.Atoi(parts[1])
	pixels := int64(width) * int64(height)
	if width%2 != 0 || height%2 != 0 || pixels < volcengineArkImageMinPixels || pixels > volcengineArkImageMaxPixels {
		t.Fatalf("normalized size = %q", size)
	}
}

func TestVolcengineArkImageDataURLsDownloadsRemoteResult(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	imageBytes := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(imageBytes)
	}))
	defer server.Close()

	images, err := volcengineArkImageDataURLs(context.Background(), providerConfig{}, imageResponse{
		Data: []map[string]interface{}{{"url": server.URL + "/generated.png"}},
	})
	if err != nil {
		t.Fatalf("volcengineArkImageDataURLs() error = %v", err)
	}
	if len(images) != 1 || !strings.HasPrefix(images[0]["dataUrl"], "data:image/png;base64,") {
		t.Fatalf("images = %#v", images)
	}

	svc := newResourceTestService(t)
	stored, err := svc.persistGeneratedMediaResult("user-1", map[string]interface{}{"mode": "image", "images": images})
	if err != nil {
		t.Fatalf("persistGeneratedMediaResult() error = %v", err)
	}
	storedImages, ok := stored["images"].([]interface{})
	if !ok || len(storedImages) != 1 {
		t.Fatalf("stored images = %#v", stored["images"])
	}
	storedImage, ok := storedImages[0].(map[string]interface{})
	if !ok || !strings.HasPrefix(stringField(storedImage, "storageKey"), "resource:") || !strings.HasPrefix(stringField(storedImage, "dataUrl"), "/api/resources/") {
		t.Fatalf("stored image = %#v", storedImages[0])
	}
}

func TestVolcengineArkImageRejectsMaskBeforeRequest(t *testing.T) {
	_, err := runImageTask(context.Background(), canvasGenerationInput{
		Prompt: "edit only the masked area",
		Config: providerConfig{InterfaceType: "volcengine-ark-image"},
		Mask:   &providerMedia{DataURL: testReferenceImageDataURL},
	})
	if err == nil || !strings.Contains(err.Error(), "不支持蒙版") {
		t.Fatalf("runImageTask() error = %v", err)
	}
}

func TestRunGeminiImageTaskUsesInlineDataAndImageConfig(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/models/gemini-test:generateContent" {
			t.Errorf("path = %q, want /v1beta/models/gemini-test:generateContent", r.URL.Path)
		}
		if got := r.Header.Get("x-goog-api-key"); got != "test-key" {
			t.Errorf("x-goog-api-key = %q, want test-key", got)
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		contents, ok := body["contents"].([]interface{})
		if !ok || len(contents) != 1 {
			t.Fatalf("contents = %#v", body["contents"])
		}
		content, _ := contents[0].(map[string]interface{})
		parts, ok := content["parts"].([]interface{})
		if !ok || len(parts) != 2 {
			t.Fatalf("parts = %#v", content["parts"])
		}
		textPart, _ := parts[0].(map[string]interface{})
		if textPart["text"] != "edit this image" {
			t.Errorf("text part = %#v", textPart)
		}
		imagePart, _ := parts[1].(map[string]interface{})
		inlineData, _ := imagePart["inlineData"].(map[string]interface{})
		if inlineData["mimeType"] != "image/png" || inlineData["data"] != "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" {
			t.Errorf("inlineData = %#v", inlineData)
		}
		generationConfig, _ := body["generationConfig"].(map[string]interface{})
		modalities, _ := generationConfig["responseModalities"].([]interface{})
		if !reflect.DeepEqual(modalities, []interface{}{"TEXT", "IMAGE"}) {
			t.Errorf("responseModalities = %#v", modalities)
		}
		imageConfig, _ := generationConfig["imageConfig"].(map[string]interface{})
		if imageConfig["aspectRatio"] != "16:9" || imageConfig["imageSize"] != "4K" {
			t.Errorf("imageConfig = %#v", imageConfig)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aGVsbG8="}}]}}]}`))
	}))
	defer server.Close()

	result, err := runImageTask(context.Background(), canvasGenerationInput{
		Prompt:          "edit this image",
		Config:          providerConfig{BaseURL: server.URL, APIKey: "test-key", APIFormat: "gemini", Model: "gemini-test", InterfaceType: "gemini-image", Size: "16:9", Quality: "high"},
		ReferenceImages: []providerMedia{{DataURL: testGeminiReferenceImageDataURL}},
	})
	if err != nil {
		t.Fatalf("runImageTask() error = %v", err)
	}
	images, _ := result["images"].([]map[string]string)
	if len(images) != 1 || images[0]["dataUrl"] != testReferenceImageDataURL {
		t.Fatalf("images = %#v", result["images"])
	}
}

func TestRunGeminiImageTaskRejectsInvalidReferenceBeforeRequest(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		http.Error(w, "unexpected upstream request", http.StatusInternalServerError)
	}))
	defer server.Close()

	_, err := runImageTask(context.Background(), canvasGenerationInput{
		Prompt:          "edit this image",
		Config:          providerConfig{BaseURL: server.URL, APIKey: "test-key", APIFormat: "gemini", Model: "gemini-test", InterfaceType: "gemini-image"},
		ReferenceImages: []providerMedia{{DataURL: "data:text/plain;base64,aGVsbG8="}},
	})
	if err == nil || !strings.Contains(err.Error(), "读取 Gemini Images 参考图失败") || !strings.Contains(err.Error(), "MIME 类型无效") {
		t.Fatalf("runImageTask() error = %v", err)
	}
	if called {
		t.Fatal("invalid reference image must be rejected before upstream request")
	}
}

func TestRunImageTaskOmitsAutomaticQualityAndSize(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if _, exists := body["quality"]; exists {
			t.Errorf("quality = %#v, want omitted for auto", body["quality"])
		}
		if _, exists := body["size"]; exists {
			t.Errorf("size = %#v, want omitted for auto", body["size"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"aGVsbG8="}]}`))
	}))
	defer server.Close()

	profile := DefaultImageCapabilityConfig("openai-image", "gpt-image-2")
	profile.Size = ImageSizeConfig{Parameter: "size", Values: []string{"auto", "1024x1024"}, Default: "1024x1024", AllowCustom: false}
	profile.Quality = ImageQualityConfig{Supported: true, Values: []string{"auto", "low", "medium", "high"}, Default: "high"}
	_, err := runImageTask(context.Background(), canvasGenerationInput{
		Prompt:          "a product photo",
		Config:          providerConfig{BaseURL: server.URL, APIKey: "key", Model: "gpt-image-2", InterfaceType: "openai-image", Size: "auto", Quality: "auto"},
		ImageCapability: profile,
	})
	if err != nil {
		t.Fatalf("runImageTask() error = %v", err)
	}
}

func TestRunOpenAIImageTaskUsesMultipartEditContract(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/edits" {
			t.Errorf("path = %q, want /v1/images/edits", r.URL.Path)
		}
		if contentType := r.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "multipart/form-data;") {
			t.Errorf("Content-Type = %q, want multipart/form-data", contentType)
		}
		if err := r.ParseMultipartForm(2 << 20); err != nil {
			t.Fatalf("ParseMultipartForm() error = %v", err)
		}
		if r.FormValue("model") != "gpt-image-2-high" || r.FormValue("prompt") != "make the reference clearer" || r.FormValue("n") != "1" {
			t.Fatalf("form values = model:%q prompt:%q n:%q", r.FormValue("model"), r.FormValue("prompt"), r.FormValue("n"))
		}
		if r.FormValue("response_format") != "b64_json" || r.FormValue("output_format") != "png" || r.FormValue("size") != "1024x1024" {
			t.Fatalf("format values = response_format:%q output_format:%q size:%q", r.FormValue("response_format"), r.FormValue("output_format"), r.FormValue("size"))
		}
		file, header, err := r.FormFile("image")
		if err != nil {
			t.Fatalf("FormFile(image) error = %v", err)
		}
		defer file.Close()
		content, err := io.ReadAll(file)
		if err != nil {
			t.Fatalf("ReadAll(image) error = %v", err)
		}
		if header.Filename != "reference-reference.png" || string(content) != "hello" {
			t.Fatalf("image = filename:%q content:%q", header.Filename, string(content))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"aGVsbG8="}]}`))
	}))
	defer server.Close()

	profile := DefaultImageCapabilityConfig("openai-image", "gpt-image-2-high")
	result, err := runImageTask(context.Background(), canvasGenerationInput{
		Mode:            "image",
		Prompt:          "make the reference clearer",
		Config:          providerConfig{BaseURL: server.URL, APIKey: "key", Model: "gpt-image-2-high", InterfaceType: "openai-image", Size: "1024x1024"},
		ImageCapability: profile,
		ReferenceImages: []providerMedia{{Name: "reference.png", Type: "image/png", DataURL: testReferenceImageDataURL}},
	})
	if err != nil {
		t.Fatalf("runImageTask() error = %v", err)
	}
	images, _ := result["images"].([]map[string]string)
	if len(images) != 1 || images[0]["dataUrl"] != "data:image/png;base64,aGVsbG8=" {
		t.Fatalf("images = %#v", result["images"])
	}
}

func TestRunGrokImageTaskUsesJSONEditContract(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/edits" {
			t.Errorf("path = %q, want /v1/images/edits", r.URL.Path)
		}
		if contentType := r.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
			t.Errorf("Content-Type = %q, want application/json", contentType)
		}
		var body grokImageRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if body.Model != "grok-imagine-image-quality" || body.N != 1 || body.ResponseFormat != "url" {
			t.Fatalf("request body = %#v", body)
		}
		if body.Image == nil || body.Image.URL != testReferenceImageDataURL {
			t.Fatalf("image = %#v", body.Image)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"url":"https://example.com/result.png"}]}`))
	}))
	defer server.Close()

	result, err := runImageTask(context.Background(), canvasGenerationInput{
		Mode:            "image",
		Prompt:          "edit the reference",
		Config:          providerConfig{BaseURL: server.URL, APIKey: "key", Model: "grok-imagine-image-quality", InterfaceType: "grok-image"},
		ReferenceImages: []providerMedia{{DataURL: testReferenceImageDataURL}},
	})
	if err != nil {
		t.Fatalf("runImageTask() error = %v", err)
	}
	images, _ := result["images"].([]map[string]string)
	if len(images) != 1 || images[0]["dataUrl"] != "https://example.com/result.png" {
		t.Fatalf("images = %#v", result["images"])
	}
}

func TestGrokImageRequestBodyMapsAspectRatio(t *testing.T) {
	body, path, err := grokImageRequestBody(canvasGenerationInput{
		Prompt: "a cat",
		Config: providerConfig{Model: "grok-imagine-image", InterfaceType: "grok-image", Size: "9:16", Quality: "2k"},
	})
	if err != nil {
		t.Fatalf("grokImageRequestBody() error = %v", err)
	}
	if path != "/images/generations" {
		t.Fatalf("path = %q", path)
	}
	if body.AspectRatio != "9:16" || body.Resolution != "2k" {
		t.Fatalf("body = %#v", body)
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	// Grok 使用 aspect_ratio；测试锁定请求 JSON，防止非法 size 字段再次混入。
	if _, exists := payload["size"]; exists {
		t.Fatalf("request body must not contain size: %s", encoded)
	}
	if got := normalizeGrokImageAspectRatio("1280x720"); got != "16:9" {
		t.Fatalf("normalize 1280x720 = %q", got)
	}
	if got := normalizeGrokImageAspectRatio("720x1280"); got != "9:16" {
		t.Fatalf("normalize 720x1280 = %q", got)
	}
}

func TestNormalizeGrokImageAspectRatioPixelSizes(t *testing.T) {
	// 像素尺寸路径必须覆盖 2:3 / 3:2 / 1:2 / 2:1：修复前 768x1152 会被 w>h 兜底错标成 9:16、
	// 1152x768 错标成 16:9，xAI 按错比例裁切生成图。
	cases := []struct {
		size string
		want string
	}{
		{"768x1152", "2:3"},  // 1280x1920 同族：竖图 2:3
		{"1280x1920", "2:3"}, // 审查复现用例
		{"1152x768", "3:2"},
		{"1920x1280", "3:2"},
		{"540x1080", "1:2"},
		{"1080x540", "2:1"},
		{"1280x720", "16:9"},
		{"720x1280", "9:16"},
		{"800x800", "1:1"},
	}
	for _, tc := range cases {
		if got := normalizeGrokImageAspectRatio(tc.size); got != tc.want {
			t.Errorf("normalizeGrokImageAspectRatio(%q) = %q, want %q", tc.size, got, tc.want)
		}
	}
	// 冒号字符串路径回归：2:3 等比值字符串应原样透传。
	for _, size := range []string{"2:3", "3:2", "1:2", "2:1"} {
		if got := normalizeGrokImageAspectRatio(size); got != size {
			t.Errorf("normalizeGrokImageAspectRatio(%q) = %q, want passthrough %q", size, got, size)
		}
	}
}

func TestNormalizeGrokImageResolution(t *testing.T) {
	if got := normalizeGrokImageResolution("1k"); got != "1k" {
		t.Fatalf("1k = %q", got)
	}
	if got := normalizeGrokImageResolution("high"); got != "2k" {
		t.Fatalf("high = %q", got)
	}
	if got := normalizeGrokImageResolution("auto"); got != "" {
		t.Fatalf("auto = %q", got)
	}
}

func TestGrokImageRequestBodyRejectsMaskAndMultipleReferences(t *testing.T) {
	if _, _, err := grokImageRequestBody(canvasGenerationInput{Config: providerConfig{InterfaceType: "grok-image"}, Mask: &providerMedia{DataURL: testReferenceImageDataURL}}); err == nil || !strings.Contains(err.Error(), "不支持蒙版") {
		t.Fatalf("mask error = %v", err)
	}
	if _, _, err := grokImageRequestBody(canvasGenerationInput{Config: providerConfig{InterfaceType: "grok-image"}, ReferenceImages: []providerMedia{{DataURL: testReferenceImageDataURL}, {DataURL: testReferenceImageDataURL}}}); err == nil || !strings.Contains(err.Error(), "只支持 1 张") {
		t.Fatalf("multiple reference error = %v", err)
	}
}

func TestGrokImageRequestBodyPrefersPublicURL(t *testing.T) {
	body, path, err := grokImageRequestBody(canvasGenerationInput{
		Config:          providerConfig{Model: "grok-imagine-image", InterfaceType: "grok-image"},
		ReferenceImages: []providerMedia{{URL: "https://example.com/reference.png", DataURL: testReferenceImageDataURL}},
	})
	if err != nil {
		t.Fatalf("grokImageRequestBody() error = %v", err)
	}
	if path != "/images/edits" || body.Image == nil || body.Image.URL != "https://example.com/reference.png" {
		t.Fatalf("path = %q, image = %#v", path, body.Image)
	}
}

func TestNormalizePixelSizeConvertsCanvasAspectRatios(t *testing.T) {
	tests := map[string]string{
		"1:1":  "1024x1024",
		"3:2":  "1536x1024",
		"2:3":  "1024x1536",
		"4:3":  "1360x1024",
		"3:4":  "1024x1360",
		"16:9": "1824x1024",
		"9:16": "1024x1824",
		"21:9": "2352x1008",
	}
	for input, want := range tests {
		t.Run(input, func(t *testing.T) {
			if got := normalizePixelSize(input); got != want {
				t.Fatalf("normalizePixelSize(%q) = %q, want %q", input, got, want)
			}
		})
	}
}

func TestDoBinaryRejectsOversizedProviderResponse(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", strconv.FormatInt(maxProviderResponseBytes+1, 10))
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	_, _, err := getExternalBinary(context.Background(), server.URL)
	if err == nil || !strings.Contains(err.Error(), "超过 64MB") {
		t.Fatalf("getExternalBinary() error = %v", err)
	}
}

func TestTextResponseInputIncludesReferenceMedia(t *testing.T) {
	input := canvasGenerationInput{
		Prompt: "describe this image",
		Config: providerConfig{SystemPrompt: "answer in Chinese"},
		ReferenceImages: []providerMedia{
			{ID: "image-1", Name: "image.png", Type: "image/png", DataURL: testReferenceImageDataURL},
		},
		ReferenceVideos: []providerMedia{
			{ID: "video-1", Name: "video.mp4", Type: "video/mp4", URL: "https://example.com/reference.mp4"},
		},
	}

	value, err := textResponseInput(input)
	if err != nil {
		t.Fatalf("textResponseInput() error = %v", err)
	}
	messages, ok := value.([]map[string]interface{})
	if !ok {
		t.Fatalf("textResponseInput() = %T, want []map[string]interface{}", value)
	}
	if len(messages) != 2 {
		t.Fatalf("len(messages) = %d, want 2", len(messages))
	}
	if messages[0]["role"] != "system" || messages[0]["content"] != "answer in Chinese" {
		t.Fatalf("system message = %#v", messages[0])
	}
	content, ok := messages[1]["content"].([]map[string]interface{})
	if !ok {
		t.Fatalf("user content = %T, want []map[string]interface{}", messages[1]["content"])
	}
	if len(content) != 3 {
		t.Fatalf("len(content) = %d, want 3", len(content))
	}
	if content[0]["type"] != "input_text" || content[0]["text"] != "describe this image" {
		t.Fatalf("text content = %#v", content[0])
	}
	if content[1]["type"] != "input_image" || content[1]["image_url"] != testReferenceImageDataURL {
		t.Fatalf("image content = %#v", content[1])
	}
	if content[2]["type"] != "input_video" || content[2]["video_url"] != "https://example.com/reference.mp4" {
		t.Fatalf("video content = %#v", content[2])
	}
}

func TestTextChatContentIncludesReferenceMedia(t *testing.T) {
	input := canvasGenerationInput{
		Prompt: "describe this image",
		ReferenceImages: []providerMedia{
			{ID: "image-1", Name: "image.png", Type: "image/png", DataURL: testReferenceImageDataURL},
		},
		ReferenceVideos: []providerMedia{
			{ID: "video-1", Name: "video.mp4", Type: "video/mp4", URL: "https://example.com/reference.mp4"},
		},
	}

	value, err := textChatContent(input)
	if err != nil {
		t.Fatalf("textChatContent() error = %v", err)
	}
	content, ok := value.([]map[string]interface{})
	if !ok {
		t.Fatalf("textChatContent() = %T, want []map[string]interface{}", value)
	}
	if len(content) != 3 {
		t.Fatalf("len(content) = %d, want 3", len(content))
	}
	if content[0]["type"] != "text" || content[0]["text"] != "describe this image" {
		t.Fatalf("text content = %#v", content[0])
	}
	imageURL, ok := content[1]["image_url"].(map[string]interface{})
	if !ok {
		t.Fatalf("image_url = %T, want map[string]interface{}", content[1]["image_url"])
	}
	if content[1]["type"] != "image_url" || imageURL["url"] != testReferenceImageDataURL {
		t.Fatalf("image content = %#v", content[1])
	}
	videoURL, ok := content[2]["video_url"].(map[string]interface{})
	if !ok {
		t.Fatalf("video_url = %T, want map[string]interface{}", content[2]["video_url"])
	}
	if content[2]["type"] != "video_url" || videoURL["url"] != "https://example.com/reference.mp4" {
		t.Fatalf("video content = %#v", content[2])
	}
}

func TestTextReferenceImageRejectsInternalAssetURL(t *testing.T) {
	_, err := textResponseInput(canvasGenerationInput{
		Prompt: "describe this image",
		ReferenceImages: []providerMedia{
			{ID: "image-1", Name: "image.png", URL: "asset://local-image"},
		},
	})
	if err == nil {
		t.Fatal("textResponseInput() error = nil, want error")
	}
}

func TestValidateGenerationInterfaceRejectsMismatchedType(t *testing.T) {
	if err := validateGenerationInterface("video", "chat-completion"); err == nil {
		t.Fatal("validateGenerationInterface() error = nil")
	}
	if err := validateGenerationInterface("video", "newapi-channel-1"); err != nil {
		t.Fatalf("validateGenerationInterface() error = %v", err)
	}
	if err := validateGenerationInterface("video", "newapi-channel-2"); err != nil {
		t.Fatalf("validateGenerationInterface() error = %v", err)
	}
	if err := validateGenerationInterface("video", "xai-video"); err != nil {
		t.Fatalf("validateGenerationInterface() error = %v", err)
	}
	if err := validateGenerationInterface("image", "grok-image"); err != nil {
		t.Fatalf("validateGenerationInterface() error = %v", err)
	}
}

func TestProcessTaskValidatesInterfaceBeforeHydratingMedia(t *testing.T) {
	input := canvasGenerationInput{
		Mode:            "image",
		Prompt:          "make it move",
		Config:          providerConfig{BaseURL: "https://8.8.8.8/v1", APIKey: "key", Model: "text-model", InterfaceType: "chat-completion"},
		ReferenceImages: []providerMedia{{StorageKey: "resource:missing"}},
	}
	raw, _ := json.Marshal(input)
	_, err := (&Service{}).processCanvasGenerationTask(context.Background(), "user-1", "", "canvas_image", "", string(raw))
	if err == nil || !strings.Contains(err.Error(), "不支持image生成") {
		t.Fatalf("processCanvasGenerationTask() error = %v", err)
	}
}

func TestResolveGenerationStyleExecutionUsesValidatedPromptAssets(t *testing.T) {
	enabled := true
	profile := styleProfileDocument{
		Prompt:          "base style",
		ExecutionPolicy: "compatible-fallback",
		Assets: []styleProfileAsset{
			{ID: "prompt-1", Kind: "prompt", Title: "色彩约束", Provider: "builtin", Enabled: &enabled, Status: "validated", PromptFragment: "muted palette", TriggerWords: []string{"soft light"}},
			{ID: "lora-1", Kind: "lora", Title: "东方角色 LoRA", Provider: "liblib", Enabled: &enabled, Status: "validated", SourceID: "model-1"},
		},
	}
	prompt, status, warnings := resolveGenerationStyleExecution(profile, "image-model", "openai-image")
	if prompt != "base style\nmuted palette\nsoft light" {
		t.Fatalf("resolveGenerationStyleExecution() prompt = %q", prompt)
	}
	if status != "degraded" || len(warnings) != 1 || !strings.Contains(warnings[0], "LoRA") {
		t.Fatalf("resolveGenerationStyleExecution() status = %q, warnings = %#v", status, warnings)
	}
}

func TestResolveGenerationStyleExecutionStrictPolicyBlocksUnsupportedAsset(t *testing.T) {
	profile := styleProfileDocument{
		Prompt:          "base style",
		ExecutionPolicy: "strict-assets",
		Assets:          []styleProfileAsset{{ID: "reference-1", Kind: "reference", Title: "项目参考图", Provider: "project", Status: "validated", ReferenceResourceIDs: []string{"resource-1"}}},
	}
	_, status, warnings := resolveGenerationStyleExecution(profile, "image-model", "openai-image")
	if status != "blocked" || len(warnings) != 1 {
		t.Fatalf("resolveGenerationStyleExecution() status = %q, warnings = %#v", status, warnings)
	}
}

func TestResolveGenerationStyleExecutionSkipsPromptAssetForOtherModel(t *testing.T) {
	profile := styleProfileDocument{
		Prompt:          "base style",
		ExecutionPolicy: "compatible-fallback",
		Assets: []styleProfileAsset{{
			ID: "template-1", Kind: "template", Title: "专用模板", Provider: "workflow", Status: "validated",
			BaseModels: []string{"supported-model"}, PromptFragment: "must not be injected",
		}},
	}
	prompt, status, warnings := resolveGenerationStyleExecution(profile, "other-model", "openai-image")
	if prompt != "base style" || status != "degraded" || len(warnings) != 1 {
		t.Fatalf("resolveGenerationStyleExecution() prompt = %q, status = %q, warnings = %#v", prompt, status, warnings)
	}
}

func TestApplyGenerationStyleProfileRebuildsStaleClientPlanForResolvedModel(t *testing.T) {
	enabled := true
	profile := styleProfileDocument{
		SchemaVersion:   1,
		PresetID:        "style-1",
		Title:           "项目画风",
		Prompt:          "base style",
		ExecutionPolicy: "compatible-fallback",
		Source:          "user",
		Revision:        1,
		Assets: []styleProfileAsset{{
			ID: "template-1", Kind: "template", Title: "旧模型模板", Provider: "workflow", Enabled: &enabled, Status: "validated",
			BaseModels: []string{"client-model"}, PromptFragment: "client-only fragment",
		}},
	}
	clientPrompt, clientStatus, _ := resolveGenerationStyleExecution(profile, "client-model", "openai-image")
	input := canvasGenerationInput{
		Mode:   "image",
		Prompt: "portrait\n\n【项目画风执行规范】\n" + clientPrompt,
		Config: providerConfig{Model: "resolved-model", InterfaceType: "openai-image"},
		Metadata: map[string]interface{}{
			"styleProfileJson": prompts.MustStyleProfileJSON(profile),
			"styleExecutionPlan": styleExecutionPlanDocument{
				SchemaVersion: 1, ProfilePresetID: profile.PresetID, ProfileRevision: profile.Revision, Mode: "image",
				Model: "client-model", InterfaceType: "openai-image", Status: clientStatus, Prompt: clientPrompt,
			},
		},
	}

	if err := (&Service{}).applyGenerationStyleProfile("user-1", "", &input); err != nil {
		t.Fatalf("applyGenerationStyleProfile() error = %v", err)
	}
	if input.Prompt != "portrait\n\n【项目画风执行规范】\nbase style" {
		t.Fatalf("applyGenerationStyleProfile() prompt = %q", input.Prompt)
	}
}

func TestEquivalentStyleProfileJSONIgnoresObjectKeyOrder(t *testing.T) {
	equal, err := equivalentStyleProfileJSON(`{"schemaVersion":1,"presetId":"style-1","assets":[]}`, `{"assets":[],"presetId":"style-1","schemaVersion":1}`)
	if err != nil || !equal {
		t.Fatalf("equivalentStyleProfileJSON() equal = %v, err = %v", equal, err)
	}
}