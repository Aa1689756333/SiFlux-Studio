// Package relayconnect owns the one-click configuration contract between the
// SiFlux relay's pages and this client.
//
// This client ships for a single relay and has no account login of its own, so
// the configuration link is the only way a credential enters the application.
// The relay's page creates the key with the user's own session and hands it over
// through the registered protocol; nothing here talks to the relay itself.
package relayconnect

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// ImportScheme is the URL scheme this application registers so the relay's
// one-click page can hand over a freshly created key.
const ImportScheme = "sifluxstudio"

const (
	importVersion    = "1"
	importPathPrefix = "provider/import"
	maxImportLinkLen = 8192
	maxImportKeyLen  = 512
)

// Import is the payload of a one-click configuration link.
type Import struct {
	Name    string `json:"name,omitempty"`
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
}

// ParseImportLink decodes a link of the form
//
//	sifluxstudio://provider/import?v=1&data=<base64(JSON)>
//
// where JSON is {"name":"SIFLUX","baseUrl":"https://api.siflux.cn/v1","apiKey":"sk-..."}.
// The payload mirrors the field names the relay's page already emits for other
// clients, so adding this application is a single entry on that page.
func ParseImportLink(raw string) (Import, error) {
	if len(raw) > maxImportLinkLen {
		return Import{}, errors.New("一键配置链接过长")
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return Import{}, errors.New("一键配置链接格式不正确")
	}
	if !strings.EqualFold(parsed.Scheme, ImportScheme) {
		return Import{}, errors.New("一键配置链接协议不正确")
	}
	// sifluxstudio://provider/import puts "provider" in Host; tolerate a leading
	// slash so sifluxstudio:/provider/import also parses.
	target := strings.Trim(parsed.Host+parsed.Path, "/")
	if target != importPathPrefix {
		return Import{}, errors.New("一键配置链接路径不正确")
	}
	query := parsed.Query()
	if query.Get("v") != importVersion {
		return Import{}, fmt.Errorf("不支持的一键配置版本 %q", query.Get("v"))
	}
	body, err := decodeImportData(query.Get("data"))
	if err != nil {
		return Import{}, err
	}
	var payload Import
	if err := json.Unmarshal(body, &payload); err != nil {
		return Import{}, errors.New("一键配置内容无法解析")
	}
	baseURL, err := normalizeImportBaseURL(payload.BaseURL)
	if err != nil {
		return Import{}, err
	}
	apiKey := strings.TrimSpace(payload.APIKey)
	if apiKey == "" {
		return Import{}, errors.New("一键配置缺少 API Key")
	}
	if len(apiKey) > maxImportKeyLen || strings.ContainsAny(apiKey, " \t\r\n") {
		return Import{}, errors.New("一键配置里的 API Key 无效")
	}
	name := strings.TrimSpace(payload.Name)
	if len(name) > 64 {
		name = name[:64]
	}
	return Import{Name: name, BaseURL: baseURL, APIKey: apiKey}, nil
}

func decodeImportData(encoded string) ([]byte, error) {
	trimmed := strings.TrimSpace(encoded)
	if trimmed == "" {
		return nil, errors.New("一键配置缺少内容")
	}
	encodings := []*base64.Encoding{
		base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding,
	}
	for _, encoding := range encodings {
		if decoded, err := encoding.DecodeString(trimmed); err == nil {
			return decoded, nil
		}
	}
	return nil, errors.New("一键配置内容不是合法的 Base64")
}

// OriginOf derives the scheme and host of a service address so a payload can be
// compared with the relay this build ships with. The path is dropped: a channel
// base URL normally carries its API root (…/v1).
func OriginOf(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", errors.New("一键配置缺少服务地址")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return "", errors.New("一键配置的服务地址格式不正确")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return "", errors.New("服务地址只支持 HTTP 或 HTTPS")
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

// normalizeImportBaseURL accepts only an absolute http(s) URL without userinfo,
// query or fragment, so a link cannot smuggle credentials into the stored origin.
func normalizeImportBaseURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", errors.New("一键配置缺少服务地址")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", errors.New("一键配置的服务地址格式不正确")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return "", errors.New("服务地址只支持 HTTP 或 HTTPS")
	}
	if parsed.Host == "" {
		return "", errors.New("服务地址缺少主机名")
	}
	if parsed.User != nil {
		return "", errors.New("服务地址不应包含用户名或密码")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("服务地址不应包含查询或片段")
	}
	return strings.TrimRight(parsed.Scheme+"://"+parsed.Host+parsed.Path, "/"), nil
}

// ImportLinkFor builds the link the relay page is expected to emit, pinning the
// contract in executable form for the application's own tests.
func ImportLinkFor(payload Import) (string, error) {
	baseURL, err := normalizeImportBaseURL(payload.BaseURL)
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(Import{Name: payload.Name, BaseURL: baseURL, APIKey: payload.APIKey})
	if err != nil {
		return "", err
	}
	query := url.Values{}
	query.Set("v", importVersion)
	query.Set("data", base64.StdEncoding.EncodeToString(body))
	return ImportScheme + "://" + importPathPrefix + "?" + query.Encode(), nil
}
