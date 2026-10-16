package desktopstorage

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// legacyRootName is the data directory name used before the product rename.
// Renaming the brand must not strand existing workspaces.
const legacyRootName = "BeefTV"

// MigrateLegacyRoot carries a pre-rename data directory over to root.
//
// Order matters. The pointer file decides where the workspace actually lives,
// so it is handled first: a user who moved the workspace to another volume
// keeps that volume. Only when no pointer exists does the legacy directory
// itself hold the data, and then a same-volume rename moves it atomically
// without copying.
//
// Every step is conservative. When in doubt the legacy directory is left
// untouched and the caller keeps working with whatever Resolve returns, so a
// failure here can delay the move but can never destroy data.
func MigrateLegacyRoot(root string) error {
	legacy := filepath.Join(filepath.Dir(root), legacyRootName)
	if filepath.Clean(legacy) == filepath.Clean(root) {
		return nil
	}
	if _, err := os.Stat(legacy); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil // fresh install
		}
		return err
	}
	if _, err := os.Stat(filepath.Join(root, locationFile)); err == nil {
		return nil // this root already owns a pointer
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if body, err := os.ReadFile(filepath.Join(legacy, locationFile)); err == nil {
		// The workspace lives on the volume the pointer names, not in the
		// legacy directory. Inherit the pointer and leave the rest alone.
		return writeLocationFile(root, body)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	entries, err := os.ReadDir(root)
	switch {
	case err == nil:
		if len(entries) != 0 {
			return nil // a newer install already owns this directory
		}
		// An empty directory must not shadow the legacy workspace.
		if err := os.Remove(root); err != nil {
			return err
		}
	case errors.Is(err, os.ErrNotExist):
	default:
		return err
	}
	return os.Rename(legacy, root)
}

// writeLocationFile publishes the inherited pointer atomically so an
// interrupted run cannot leave a truncated pointer behind.
func writeLocationFile(root string, body []byte) error {
	if err := os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(root, ".storage-location-legacy-*")
	if err != nil {
		return err
	}
	path := file.Name()
	defer os.Remove(path)
	if err = file.Chmod(0o600); err == nil {
		_, err = file.Write(body)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(path, filepath.Join(root, locationFile)); err != nil {
		return fmt.Errorf("继承旧数据目录设置失败: %w", err)
	}
	return nil
}
