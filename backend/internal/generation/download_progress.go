package generation

import (
	"context"
	"io"
	"time"
)

// downloadProgressInterval throttles byte observations; the final read (io.EOF
// or a read error) is always observed so the last count is never lost.
const downloadProgressInterval = 500 * time.Millisecond

type downloadObserverContext struct{}

// downloadObserver receives the bytes read from a response body. total is -1
// when the server did not declare a length.
type downloadObserver func(downloaded, total int64)

// withDownloadObserver scopes byte observation to one download attempt. Requests
// without an observer read the body exactly as before.
func withDownloadObserver(ctx context.Context, observe downloadObserver) context.Context {
	return context.WithValue(ctx, downloadObserverContext{}, observe)
}

func downloadObserverFrom(ctx context.Context) downloadObserver {
	observe, _ := ctx.Value(downloadObserverContext{}).(downloadObserver)
	return observe
}

type progressReader struct {
	reader   io.Reader
	total    int64
	read     int64
	cap      int64
	observe  downloadObserver
	lastSent time.Time
}

// newProgressReader reports total as the response's declared length; net/http
// already uses -1 when the server did not send one. Reported bytes never exceed
// keep, the amount the caller retains; a read past it is the caller's overflow.
func newProgressReader(reader io.Reader, contentLength, keep int64, observe downloadObserver) io.Reader {
	return &progressReader{reader: reader, total: contentLength, cap: keep, observe: observe}
}

func (r *progressReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.read += int64(n)
	now := time.Now()
	// A read past cap is the overflow the caller rejects, so it is the final count.
	overflow := r.read > r.cap
	if err != nil || overflow || now.Sub(r.lastSent) >= downloadProgressInterval {
		r.lastSent = now
		r.observe(min(r.read, r.cap), r.total)
	}
	return n, err
}
