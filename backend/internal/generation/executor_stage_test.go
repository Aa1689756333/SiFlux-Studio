package generation

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

type stageRecorder struct {
	events *[]string
	err    error
}

func (s stageRecorder) SetStage(_ context.Context, stage string) error {
	*s.events = append(*s.events, stage)
	return s.err
}

type stageConfig struct {
	events *[]string
	err    error
	cancel context.CancelFunc
}

type stageResources struct {
	ResourcePort
	events *[]string
}

func (p stageResources) Lookup(string, string) (ResourceInfo, error) {
	*p.events = append(*p.events, "hydrate")
	return ResourceInfo{Status: "ready", MimeType: "image/png"}, nil
}
func (p stageResources) Open(string, string) (ResourceInfo, io.ReadCloser, error) {
	return ResourceInfo{MimeType: "image/png"}, io.NopCloser(strings.NewReader("image")), nil
}
func (p stageResources) LocalMode() bool { return true }

func (p stageConfig) Resolve(c Config) (Config, error)                { return c, nil }
func (p stageConfig) ApplyCapabilities(context.Context, *Input) error { return nil }
func (p stageConfig) RequireWorkflow(string) error                    { return nil }
func (p stageConfig) SyncArkPrivateAssets(context.Context, string, *Input) error {
	*p.events = append(*p.events, "hydrate/upload")
	if p.cancel != nil {
		p.cancel()
	}
	return p.err
}

func TestExecuteReferenceStages(t *testing.T) {
	for _, tc := range []struct {
		name                                                              string
		reference, resumed, failPreparation, cancelPreparation, failStage bool
		want                                                              []string
		wantError                                                         bool
	}{
		{name: "reference", reference: true, want: []string{"正在准备参考图片", "hydrate", "正在提交生图任务", "submit"}},
		{name: "no reference", want: []string{"submit"}},
		{name: "resume", reference: true, resumed: true, want: []string{"submit"}},
		{name: "lost lease", reference: true, failStage: true, want: []string{"正在准备参考图片"}, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
			var events []string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				events = append(events, "submit")
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"data":[{"b64_json":"YQ=="}]}`))
			}))
			defer server.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			config := stageConfig{events: &events}
			stages := stageRecorder{events: &events}
			if tc.failPreparation {
				config.err = errors.New("upload failed")
			}
			if tc.cancelPreparation {
				config.cancel = cancel
			}
			if tc.failStage {
				stages.err = errors.New("lease lost")
			}
			runtime := taskRuntime(func(r *Runtime) {
				r.Stages, r.Config = stages, config
				r.Resources = stageResources{events: &events}
				if tc.resumed {
					r.Call.ProviderRequestID = "existing"
				}
			})
			input := Input{Mode: "image", Prompt: "describe", Config: Config{BaseURL: server.URL, APIKey: "key", Model: "img"}}
			if tc.reference {
				input.ReferenceImages = []Media{{StorageKey: "resource:reference"}}
				if tc.resumed {
					input.ReferenceImages[0].DataURL = "data:image/png;base64,aGVsbG8="
				}
			}
			_, err := Execute(WithRuntime(ctx, runtime), input)
			if (err != nil) != tc.wantError {
				t.Fatalf("error = %v", err)
			}
			if !reflect.DeepEqual(events, tc.want) {
				t.Fatalf("events = %v, want %v", events, tc.want)
			}
		})
	}
}
