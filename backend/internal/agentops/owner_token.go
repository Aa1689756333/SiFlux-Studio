package agentops

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

// atomicWriteFile 先写临时文件再改名，避免并发写凭据时留下半截文件。
func atomicWriteFile(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".agent-credential-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}

// OwnerTokenPath 是后端与可信本机前端共享的 owner 凭据；只有它能执行写操作。
func OwnerTokenPath(dataDir string) string { return filepath.Join(dataDir, "agent_owner_token") }

// EnsureOwnerToken 读取已有 owner token，不存在则生成（0600）。
func EnsureOwnerToken(dataDir string) (string, error) {
	path := OwnerTokenPath(dataDir)
	if raw, err := os.ReadFile(path); err == nil {
		if token := strings.TrimSpace(string(raw)); token != "" {
			return token, nil
		}
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := hex.EncodeToString(buf)
	if err := atomicWriteFile(path, []byte(token)); err != nil {
		return "", err
	}
	return token, nil
}

// OwnerTokenMatches 用常量时间比较 owner 凭据。
func OwnerTokenMatches(dataDir, presented string) bool {
	expected, err := EnsureOwnerToken(dataDir)
	if err != nil || presented == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(presented)) == 1
}

// HostTokenPath 是内置助手宿主的专属凭据：只由后端注入宿主进程，页面拿不到。
func HostTokenPath(dataDir string) string { return filepath.Join(dataDir, "agent_host_token") }

// HostTokenMatches 判断请求是否来自已鉴权的内置助手宿主。
// 回合归属只认这个身份：owner 通道即使拿到 turnId，也不能自报归属。
// 取值顺序与 handler.readAgentHostToken 完全一致（显式环境变量优先，其次数据目录文件），
// 否则宿主拿到的是环境变量、这里读的是文件，两边会悄悄对不上。
func HostTokenMatches(dataDir, presented string) bool {
	presented = strings.TrimSpace(presented)
	if presented == "" {
		return false
	}
	expected := strings.TrimSpace(os.Getenv("SIFLUX_AGENT_HOST_TOKEN"))
	if expected == "" {
		if strings.TrimSpace(dataDir) == "" {
			return false
		}
		raw, err := os.ReadFile(HostTokenPath(dataDir))
		if err != nil {
			return false
		}
		expected = strings.TrimSpace(string(raw))
	}
	if expected == "" || len(expected) != len(presented) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(presented)) == 1
}

// EnsureAgentCredentials 在组合根生成 owner 凭据与宿主凭据；DataDir 为空时明确报错，不写 CWD。
func EnsureAgentCredentials(dataDir string) {
	if strings.TrimSpace(dataDir) == "" {
		return
	}
	if _, err := EnsureOwnerToken(dataDir); err != nil {
		return
	}
	hostPath := filepath.Join(dataDir, "agent_host_token")
	if _, err := os.Stat(hostPath); err == nil {
		return
	}
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return
	}
	_ = atomicWriteFile(hostPath, []byte(hex.EncodeToString(buf)))
}
