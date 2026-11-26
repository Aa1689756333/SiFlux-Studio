package generation

import (
	"regexp"
	"strings"
)

var referenceDebugIDs = regexp.MustCompile(`。排查编号：([^。]+)。?$`)

// persistedReferenceIDs reads the sanitized debug identifiers appended to
// persisted task failures without trusting any other part of the message.
func persistedReferenceIDs(text string) (requestID, taskID string) {
	m := referenceDebugIDs.FindStringSubmatch(text)
	if len(m) != 2 {
		return
	}
	for _, part := range strings.Split(m[1], " · ") {
		if strings.HasPrefix(part, "请求 ") {
			requestID = sanitizeDebugID(strings.TrimPrefix(part, "请求 "))
		}
		if strings.HasPrefix(part, "任务 ") {
			taskID = sanitizeDebugID(strings.TrimPrefix(part, "任务 "))
		}
	}
	return
}
