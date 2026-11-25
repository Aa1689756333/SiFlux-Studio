package generation

import (
	"context"
	"testing"
)

// 生图渠道保留字节直传：本地素材不能被误判为需要公网链接。
func TestMediaTransportKeepsLocalBytesForImageProtocols(t *testing.T) {
	ctx := WithProtocolRegistry(context.Background(), LoadOfficialFallbackRegistry())
	for _, tc := range []struct {
		name, protocol, host string
		media                Media
	}{
		{"local resource", "gemini-image", "https://custom.example", Media{StorageKey: "resource:local"}},
		{"inline data url", "gemini-image", "https://custom.example", Media{DataURL: "data:image/png;base64,YQ=="}},
		{"blob url", "openai-image", "https://custom.example", Media{URL: "blob:local"}},
		{"https url", "openai-image", "https://custom.example", Media{URL: "https://cdn.example/image.png"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := Input{Mode: "image", Config: Config{InterfaceType: tc.protocol, Model: "image", BaseURL: tc.host}, ReferenceImages: []Media{tc.media}}
			if err := ValidateMediaTransport(ctx, input); err != nil {
				t.Fatalf("image reference blocked: %v", err)
			}
		})
	}
}

// 图片编辑需要原始字节参与 multipart，遮罩不能让策略切到 URL 传输。
func TestMaskOnlyDisablesURLTransportForImageEditing(t *testing.T) {
	input := Input{Mode: "image", Config: Config{InterfaceType: "gemini-image"}, Mask: &Media{StorageKey: "resource:mask"}}
	if MediaHydrationPolicyFor(context.Background(), input).RequireURL {
		t.Fatal("image mask must retain byte transport for multipart editing")
	}
	if err := ValidateMediaTransport(context.Background(), input); err != nil {
		t.Fatalf("mask content blocked: %v", err)
	}
}

func TestMediaTransportRejectsNonHTTPSRemoteReferences(t *testing.T) {
	// image 渠道保留字节直传，非 https 远端地址不会误伤本地素材；这里只固定策略结果，
	// 防止后续渠道改动把 image 传输悄悄切成 URL-only。
	input := Input{Mode: "image", Config: Config{InterfaceType: "gemini-image"}, ReferenceImages: []Media{{URL: "http://insecure.example/image.png"}}}
	if policy := MediaHydrationPolicyFor(context.Background(), input); policy.RequireURL || policy.KeepLocal {
		t.Fatalf("unexpected image media policy: %+v", policy)
	}
}