//go:build !windows

package main

// registerURLScheme has nothing to do at runtime on these platforms: macOS
// declares the scheme through CFBundleURLTypes in the bundled Info.plist and
// Linux through MimeType=x-scheme-handler/… in its .desktop entry. Both are
// produced by packaging, so a development build cannot register and does not
// need to.
func registerURLScheme() error {
	return nil
}
