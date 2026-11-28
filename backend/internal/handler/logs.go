package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type logEntry struct {
	Time    string `json:"time"`
	Level   string `json:"level"`
	Message string `json:"message"`
}

type logBuffer struct {
	mu      sync.Mutex
	entries []logEntry
	path    string
}

const logBufferLimit = 500

func newLogBuffer(dataDir string) *logBuffer {
	buffer := &logBuffer{path: filepath.Join(dataDir, "logs", "app.log")}
	_ = os.MkdirAll(filepath.Dir(buffer.path), 0o750)
	return buffer
}

func (b *logBuffer) append(level, message string) {
	entry := logEntry{Time: time.Now().Format("2006-01-02 15:04:05"), Level: level, Message: message}
	b.mu.Lock()
	b.entries = append(b.entries, entry)
	if len(b.entries) > logBufferLimit {
		b.entries = b.entries[len(b.entries)-logBufferLimit:]
	}
	line := entry.Time + " [" + level + "] " + message + "\n"
	b.mu.Unlock()
	if file, err := os.OpenFile(b.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
		_, _ = file.WriteString(line)
		_ = file.Close()
	}
}

func (b *logBuffer) tail(limit int) []logEntry {
	b.mu.Lock()
	defer b.mu.Unlock()
	if limit <= 0 || limit > len(b.entries) {
		limit = len(b.entries)
	}
	out := make([]logEntry, limit)
	copy(out, b.entries[len(b.entries)-limit:])
	for left, right := 0, len(out)-1; left < right; left, right = left+1, right-1 {
		out[left], out[right] = out[right], out[left]
	}
	return out
}

// RegisterLogRoutes 提供应用日志读取，并记录接口访问。
func RegisterLogRoutes(api *gin.RouterGroup, dataDir string) {
	buffer := newLogBuffer(dataDir)
	buffer.append("info", "应用已启动")

	api.Use(func(c *gin.Context) {
		started := time.Now()
		c.Next()
		status := c.Writer.Status()
		level := "info"
		if status >= http.StatusInternalServerError {
			level = "error"
		} else if status >= http.StatusBadRequest {
			level = "warn"
		}
		if strings.HasPrefix(c.Request.URL.Path, "/logs") {
			return
		}
		// 失败请求要带上可交接给开发者的原因，成功请求只留一行访问记录。
		if level == "info" {
			buffer.append(level, c.Request.Method+" "+c.Request.URL.Path+" "+strconv.Itoa(status)+" "+time.Since(started).Round(time.Millisecond).String())
			return
		}
		detail := strings.TrimSpace(c.Errors.String())
		if detail == "" {
			detail = userFacingErrorFromBody(c)
		}
		buffer.append(level, c.Request.Method+" "+c.Request.URL.Path+" "+strconv.Itoa(status)+" "+time.Since(started).Round(time.Millisecond).String()+" "+detail)
	})

	api.GET("/logs/meta", func(c *gin.Context) {
		executable, _ := os.Executable()
		ok(c, gin.H{
			"version":  strings.TrimSpace(os.Getenv("SIFLUX_VERSION")),
			"platform": runtime.GOOS + "/" + runtime.GOARCH,
			"logFile":  buffer.path,
			"exeDir":   filepath.Dir(executable),
		})
	})

	api.GET("/logs", func(c *gin.Context) {
		limit := 200
		if raw := c.Query("limit"); raw != "" {
			if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
				limit = parsed
			}
		}
		ok(c, gin.H{"entries": buffer.tail(limit), "path": buffer.path})
	})
}

// userFacingErrorFromBody 取业务响应里的 msg，便于用户直接交接给开发者。
func userFacingErrorFromBody(c *gin.Context) string {
	if value, exists := c.Get("appErrorMessage"); exists {
		if text, ok := value.(string); ok {
			return text
		}
	}
	return ""
}
