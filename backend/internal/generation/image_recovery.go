package generation

import (
	"errors"
	"net/http"
)

// ErrImageOwnerMissing is returned when a recoverable BeefAPI image POST has
// no Images port or the port declined to take ownership. Callers must not
// open a new upstream request.
var ErrImageOwnerMissing = errors.New("图片请求缺少恢复所有者")

// RecoverableImageEndpoint reports whether req is a paid BeefAPI image create
// that must run through ImageSubmissionPort. Other hosts stay on the normal
// POST path.
func RecoverableImageEndpoint(req *http.Request) bool {
	if req == nil || req.URL == nil || req.Method != http.MethodPost || req.URL.Scheme != "https" || req.URL.User != nil || req.URL.RawQuery != "" || (req.URL.Port() != "" && req.URL.Port() != "443") {
		return false
	}
	// The managed channel's hosts are gone; no request can be a recoverable paid image
	// create any more. The submission layer is now unreachable and is removed next.
	return false
}
