package github

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"
)

type RepoMetadata struct {
	Name          string `json:"name"`
	Description   string `json:"description"`
	DefaultBranch string `json:"default_branch"`
	Stars         int    `json:"stargazers_count"`
}

type FileEntry struct {
	Path    string
	Content string
	Size    int64
}

type GitHubClient struct {
	token string
}

func NewGitHubClient(token string) *GitHubClient {
	return &GitHubClient{token: token}
}

// ParseRepositoryURL extracts owner and repository name from GitHub URL
func ParseRepositoryURL(repoURL string) (owner string, repo string, err error) {
	// Cleans up URL and splits it
	u, err := url.Parse(strings.TrimSpace(repoURL))
	if err != nil {
		return "", "", fmt.Errorf("invalid URL: %w", err)
	}

	if !strings.Contains(u.Host, "github.com") {
		return "", "", fmt.Errorf("only github.com repositories are supported")
	}

	pathParts := strings.FieldsFunc(u.Path, func(r rune) bool { return r == '/' })
	if len(pathParts) < 2 {
		return "", "", fmt.Errorf("invalid github URL path structure")
	}

	// First two parts are owner and repo name
	owner = pathParts[0]
	repo = strings.TrimSuffix(pathParts[1], ".git")
	return owner, repo, nil
}

// GetMetadata fetches details about the repository
func (g *GitHubClient) GetMetadata(owner, repo string) (*RepoMetadata, error) {
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/%s", owner, repo)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Accept", "application/vnd.github.v3+json")
	if g.token != "" {
		req.Header.Set("Authorization", "Bearer "+g.token)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github API responded with status %d", resp.StatusCode)
	}

	var metadata RepoMetadata
	if err := json.NewDecoder(resp.Body).Decode(&metadata); err != nil {
		return nil, err
	}

	return &metadata, nil
}

// DownloadZip downloads the source code ZIP archive of the repository
func (g *GitHubClient) DownloadZip(owner, repo, branch string) ([]byte, error) {
	zipURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/zipball/%s", owner, repo, branch)
	req, err := http.NewRequest("GET", zipURL, nil)
	if err != nil {
		return nil, err
	}

	if g.token != "" {
		req.Header.Set("Authorization", "Bearer "+g.token)
	}

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed downloading repository zip, status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed reading zip body: %w", err)
	}

	return body, nil
}

// ExtractFiles filters and extracts readable text files from repository ZIP bytes
func ExtractFiles(zipBytes []byte) ([]FileEntry, error) {
	r, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil, fmt.Errorf("failed reading zip file: %w", err)
	}

	var entries []FileEntry
	for _, f := range r.File {
		// Ignore directories
		if f.FileInfo().IsDir() {
			continue
		}

		// Find the relative path inside the repository by removing the top-level folder prefix
		// GitHub zipballs root contains a single top-level folder named like "owner-repo-commit"
		parts := strings.SplitN(f.Name, "/", 2)
		if len(parts) < 2 {
			continue
		}
		relPath := parts[1]

		// Skip paths we do not want to parse
		if shouldSkipPath(relPath) {
			continue
		}

		// Check if it's a code/doc file extension
		if !isSupportedExtension(relPath) {
			continue
		}

		// Read file contents
		rc, err := f.Open()
		if err != nil {
			continue
		}

		// Safeguard: don't load files larger than 1MB
		if f.UncompressedSize64 > 1024*1024 {
			rc.Close()
			continue
		}

		contentBytes, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}

		// Simple UTF-8 validation/safety check (ignore binary files)
		if isBinary(contentBytes) {
			continue
		}

		entries = append(entries, FileEntry{
			Path:    relPath,
			Content: string(contentBytes),
			Size:    int64(len(contentBytes)),
		})
	}

	return entries, nil
}

func shouldSkipPath(path string) bool {
	lower := strings.ToLower(path)
	skipDirs := []string{
		"node_modules/", "vendor/", "build/", "dist/", "target/", "bin/",
		".git/", ".idea/", ".vscode/", ".gradle/", ".mvn/", "package-lock.json",
		"yarn.lock", "pnpm-lock.yaml", "go.sum",
	}
	for _, sd := range skipDirs {
		if strings.Contains(lower, sd) {
			return true
		}
	}
	return false
}

func isSupportedExtension(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	supported := map[string]bool{
		".md": true, ".txt": true, ".rst": true, ".json": true,
		".go": true, ".py": true, ".js": true, ".ts": true,
		".jsx": true, ".tsx": true, ".java": true, ".rs": true,
		".c": true, ".cpp": true, ".h": true, ".cs": true,
		".yml": true, ".yaml": true, ".sql": true, ".sh": true,
		".rb": true, ".php": true, ".html": true, ".css": true,
	}
	return supported[ext]
}

func isBinary(data []byte) bool {
	// If it contains null bytes, it's likely a binary file
	limit := 512
	if len(data) < limit {
		limit = len(data)
	}
	for i := 0; i < limit; i++ {
		if data[i] == 0 {
			return true
		}
	}
	return false
}
