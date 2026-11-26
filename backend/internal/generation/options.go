package generation

import (
	"context"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"time"
)

// IsPublicMediaURL reports whether a provider-supplied value may be fetched as
// a remote media URL. Only absolute HTTP(S) values qualify.
func IsPublicMediaURL(value string) bool {
	lower := strings.ToLower(value)
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")
}

func NormalizeImageQuality(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1k":
		return "low"
	case "2k":
		return "medium"
	case "4k":
		return "high"
	default:
		return value
	}
}

func ImageParameterSupported(profile *ImageCapabilityConfig, parameter string) bool {
	if profile == nil {
		return true
	}
	if parameter == "response_format" {
		return profile.ResponseFormat.Supported
	}
	return profile.OutputFormat.Supported
}

func ImageQualitySupported(profile *ImageCapabilityConfig) bool {
	return profile == nil || profile.Quality.Supported
}

func ImageTransparentBackgroundSupported(profile *ImageCapabilityConfig) bool {
	return profile == nil || profile.TransparentBackground.Supported
}

func ImageSizeParameter(profile *ImageCapabilityConfig, value string) (string, string) {
	if profile == nil {
		return "size", NormalizePixelSize(value)
	}
	value = strings.TrimSpace(value)
	if strings.EqualFold(value, "auto") {
		return "", ""
	}
	if value == "" {
		value = strings.TrimSpace(profile.Size.Default)
	}
	switch profile.Size.Parameter {
	case "size":
		return "size", NormalizePixelSize(value)
	case "aspect_ratio":
		return "aspect_ratio", NormalizeImageAspectRatio(value)
	default:
		return "", ""
	}
}

func NormalizeImageAspectRatio(value string) string {
	value = strings.TrimSpace(strings.ToLower(strings.ReplaceAll(value, "×", "x")))
	if strings.Contains(value, ":") {
		return value
	}
	parts := strings.Split(value, "x")
	if len(parts) != 2 {
		return ""
	}
	width, widthErr := strconv.Atoi(strings.TrimSpace(parts[0]))
	height, heightErr := strconv.Atoi(strings.TrimSpace(parts[1]))
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return ""
	}
	divisor := ImageDimensionGCD(width, height)
	return strconv.Itoa(width/divisor) + ":" + strconv.Itoa(height/divisor)
}

func ImageDimensionGCD(left int, right int) int {
	for right != 0 {
		left, right = right, left%right
	}
	if left < 1 {
		return 1
	}
	return left
}

func NormalizePixelSize(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "auto" {
		return ""
	}
	// 画布按比例保存常用预设；图片接口只接受像素尺寸，必须在请求边界完成转换。
	switch value {
	case "1:1":
		return "1024x1024"
	case "3:2":
		return "1536x1024"
	case "2:3":
		return "1024x1536"
	case "4:3":
		return "1360x1024"
	case "3:4":
		return "1024x1360"
	case "16:9":
		return "1824x1024"
	case "9:16":
		return "1024x1824"
	case "21:9":
		return "2352x1008"
	}
	if strings.Contains(value, "x") {
		return value
	}
	return ""
}

func ParseBool(value string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true":
		return true
	case "false":
		return false
	default:
		return fallback
	}
}

func ParseFloat(value string, fallback float64) float64 {
	number, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || number == 0 {
		return fallback
	}
	return number
}

func SleepContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func DecodeProviderDataURL(value string) (string, []byte, error) {
	header, encoded, ok := strings.Cut(value, ",")
	if !ok || !strings.HasPrefix(header, "data:") || !strings.HasSuffix(strings.ToLower(header), ";base64") {
		return "", nil, errors.New("data URL 格式无效")
	}
	mimeType := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	data, err := base64.StdEncoding.DecodeString(encoded)
	return mimeType, data, err
}
