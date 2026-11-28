package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

const downloadSettingsFile = "download-settings.json"

type downloadSettings struct {
	Directory string `json:"directory"`
}

// defaultDownloadDirectory 返回安装目录下的 downloads 子目录。
func defaultDownloadDirectory() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	return filepath.Join(filepath.Dir(executable), "downloads")
}

func downloadSettingsPath(dataDir string) string {
	return filepath.Join(dataDir, downloadSettingsFile)
}

func readDownloadSettings(dataDir string) downloadSettings {
	settings := downloadSettings{Directory: defaultDownloadDirectory()}
	raw, err := os.ReadFile(downloadSettingsPath(dataDir))
	if err != nil {
		return settings
	}
	var stored downloadSettings
	if err := json.Unmarshal(raw, &stored); err != nil {
		return settings
	}
	if dir := strings.TrimSpace(stored.Directory); dir != "" {
		settings.Directory = dir
	}
	return settings
}

// RegisterDownloadRoutes 提供下载目录的读取、修改与写入接口。
func RegisterDownloadRoutes(api *gin.RouterGroup, dataDir string) {
	api.GET("/downloads/directory", func(c *gin.Context) {
		settings := readDownloadSettings(dataDir)
		ok(c, gin.H{"directory": settings.Directory, "default": defaultDownloadDirectory()})
	})

	api.PUT("/downloads/directory", func(c *gin.Context) {
		var body struct {
			Directory string `json:"directory"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			fail(c, http.StatusBadRequest, errors.New("下载目录参数无效"))
			return
		}
		dir := strings.TrimSpace(body.Directory)
		if dir == "" {
			dir = defaultDownloadDirectory()
		}
		absolute, err := filepath.Abs(dir)
		if err != nil {
			fail(c, http.StatusBadRequest, errors.New("下载目录路径无效"))
			return
		}
		if err := os.MkdirAll(absolute, 0o750); err != nil {
			fail(c, http.StatusBadRequest, errors.New("无法创建该目录，请换一个位置"))
			return
		}
		if err := os.WriteFile(downloadSettingsPath(dataDir), mustJSON(downloadSettings{Directory: absolute}), 0o600); err != nil {
			fail(c, http.StatusInternalServerError, errors.New("保存下载目录失败"))
			return
		}
		ok(c, gin.H{"directory": absolute})
	})

	// 保存图片到已配置的下载目录，文件名冲突时自动加序号。
	api.POST("/downloads/save", func(c *gin.Context) {
		file, header, err := c.Request.FormFile("file")
		if err != nil {
			fail(c, http.StatusBadRequest, errors.New("缺少文件内容"))
			return
		}
		defer file.Close()
		settings := readDownloadSettings(dataDir)
		if err := os.MkdirAll(settings.Directory, 0o750); err != nil {
			fail(c, http.StatusInternalServerError, errors.New("下载目录不可写"))
			return
		}
		name := safeDownloadName(c.PostForm("name"), header.Filename)
		target := filepath.Join(settings.Directory, name)
		for index := 1; ; index++ {
			if _, err := os.Stat(target); os.IsNotExist(err) {
				break
			}
			ext := filepath.Ext(name)
			base := strings.TrimSuffix(name, ext)
			target = filepath.Join(settings.Directory, base+" ("+itoa(index)+")"+ext)
			if index > 500 {
				break
			}
		}
		output, err := os.Create(target)
		if err != nil {
			fail(c, http.StatusInternalServerError, errors.New("无法写入文件"))
			return
		}
		defer output.Close()
		if _, err := io.Copy(output, file); err != nil {
			fail(c, http.StatusInternalServerError, errors.New("写入文件失败"))
			return
		}
		ok(c, gin.H{"path": target, "directory": settings.Directory})
	})
}

func safeDownloadName(preferred, fallback string) string {
	name := strings.TrimSpace(preferred)
	if name == "" {
		name = filepath.Base(strings.TrimSpace(fallback))
	}
	name = filepath.Base(name)
	name = strings.Map(func(r rune) rune {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			return '_'
		}
		return r
	}, name)
	if name == "" || name == "." || name == ".." {
		name = "image.png"
	}
	if filepath.Ext(name) == "" {
		name += ".png"
	}
	return name
}

func mustJSON(value any) []byte {
	raw, err := json.Marshal(value)
	if err != nil {
		return []byte("{}")
	}
	return raw
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	digits := make([]byte, 0, 8)
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	return string(digits)
}
