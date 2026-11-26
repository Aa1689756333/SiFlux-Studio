package relayclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newFakeRelay 模拟 NewAPI 的注册、登录、令牌与额度接口。
func newFakeRelay(t *testing.T) (*httptest.Server, *int) {
	t.Helper()
	createdTokens := 0
	mux := http.NewServeMux()
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, _ *http.Request) {
		writeEnvelope(w, map[string]any{
			"system_name":               "SiFlux API",
			"register_enabled":          true,
			"password_register_enabled": true,
			"password_login_enabled":    true,
			"email_verification":        true,
			"turnstile_check":           false,
			"quota_per_unit":            500000,
		})
	})
	mux.HandleFunc("/api/verification", func(w http.ResponseWriter, _ *http.Request) {
		writeEnvelope(w, nil)
	})
	mux.HandleFunc("/api/user/register", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		if body["verification_code"] != "123456" {
			w.WriteHeader(http.StatusOK)
			writeEnvelopeMessage(w, false, "verification code is incorrect", nil)
			return
		}
		writeEnvelope(w, nil)
	})
	mux.HandleFunc("/api/user/login", func(w http.ResponseWriter, _ *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "session", Value: "session-token"})
		writeEnvelope(w, nil)
	})
	mux.HandleFunc("/api/token/", func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Cookie"), "session=session-token") {
			w.WriteHeader(http.StatusUnauthorized)
			writeEnvelopeMessage(w, false, "session required", nil)
			return
		}
		createdTokens++
		writeEnvelope(w, map[string]any{"id": 7})
	})
	mux.HandleFunc("/api/token/7/key", func(w http.ResponseWriter, _ *http.Request) {
		writeEnvelope(w, map[string]any{"key": "sk-generated"})
	})
	mux.HandleFunc("/api/user/self", func(w http.ResponseWriter, _ *http.Request) {
		writeEnvelope(w, map[string]any{
			"id":       12,
			"username": "alice",
			"group":    "default",
			"quota":    2000000,
		})
	})
	mux.HandleFunc("/v1/models", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-generated" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"bad key"}}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{{"id": "gpt-image-2.5"}, {"id": "gpt-5.5"}},
		})
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server, &createdTokens
}

func writeEnvelope(w http.ResponseWriter, data any) { writeEnvelopeMessage(w, true, "", data) }

func writeEnvelopeMessage(w http.ResponseWriter, success bool, message string, data any) {
	payload := map[string]any{"success": success, "message": message}
	if data != nil {
		payload["data"] = data
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

func TestStatusReadsRegistrationPolicy(t *testing.T) {
	server, _ := newFakeRelay(t)
	client, err := New(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	options, err := client.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !options.RegisterEnabled || !options.PasswordRegister || !options.EmailVerification {
		t.Fatalf("unexpected options: %+v", options)
	}
	if options.Turnstile {
		t.Fatal("turnstile should be off in the fixture")
	}
	if options.QuotaPerUnit != 500000 {
		t.Fatalf("quota per unit = %v", options.QuotaPerUnit)
	}
}

func TestSignupFlowCreatesTokenAndReadsQuota(t *testing.T) {
	server, createdTokens := newFakeRelay(t)
	client, err := New(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	if err := client.SendVerificationCode(ctx, "alice@example.com"); err != nil {
		t.Fatal(err)
	}
	if err := client.Register(ctx, RegisterRequest{
		Username: "alice",
		Password: "password123",
		Email:    "alice@example.com",
		Code:     "123456",
	}); err != nil {
		t.Fatal(err)
	}

	session, err := client.Login(ctx, "alice", "password123")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(session, "session=session-token") {
		t.Fatalf("session cookie = %q", session)
	}

	token, err := client.CreateToken(ctx, session, relayTokenFixtureName)
	if err != nil {
		t.Fatal(err)
	}
	if token.Key != "sk-generated" {
		t.Fatalf("token key = %q", token.Key)
	}
	if *createdTokens != 1 {
		t.Fatalf("created tokens = %d", *createdTokens)
	}

	self, err := client.Self(ctx, session)
	if err != nil {
		t.Fatal(err)
	}
	if self.Quota != 2000000 || self.Username != "alice" {
		t.Fatalf("self = %+v", self)
	}

	models, err := client.Models(ctx, token.Key)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0] != "gpt-image-2.5" {
		t.Fatalf("models = %v", models)
	}
}

const relayTokenFixtureName = "SiFlux Desktop"

func TestRegisterSurfacesRelayMessage(t *testing.T) {
	server, _ := newFakeRelay(t)
	client, err := New(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	err = client.Register(context.Background(), RegisterRequest{
		Username: "alice",
		Password: "password123",
		Email:    "alice@example.com",
		Code:     "000000",
	})
	if err == nil {
		t.Fatal("expected failure for wrong code")
	}
	relayErr, ok := IsError(err)
	if !ok {
		t.Fatalf("expected relay error, got %v", err)
	}
	if !strings.Contains(relayErr.Message, "verification code") {
		t.Fatalf("message = %q", relayErr.Message)
	}
}

func TestLoginWithoutSessionCookieFails(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/user/login", func(w http.ResponseWriter, _ *http.Request) {
		writeEnvelope(w, nil)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client, err := New(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Login(context.Background(), "alice", "password123"); err == nil {
		t.Fatal("expected failure without session cookie")
	}
}

func TestModelsRejectsBadKey(t *testing.T) {
	server, _ := newFakeRelay(t)
	client, err := New(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Models(context.Background(), "sk-wrong"); err == nil {
		t.Fatal("expected failure for wrong key")
	}
}
