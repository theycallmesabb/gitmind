package worker

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github-assistant/backend/internal/ai"
	"github-assistant/backend/internal/github"
	"github-assistant/backend/internal/models"
	"github-assistant/backend/internal/vector"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Worker struct {
	db           *gorm.DB
	githubClient *github.GitHubClient
	vectorClient *vector.QdrantClient
	aiService    ai.AIService
	jobQueue     chan uint
}

func NewWorker(db *gorm.DB, gh *github.GitHubClient, vec *vector.QdrantClient, aiSvc ai.AIService) *Worker {
	return &Worker{
		db:           db,
		githubClient: gh,
		vectorClient: vec,
		aiService:    aiSvc,
		jobQueue:     make(chan uint, 100),
	}
}

func (w *Worker) Start(ctx context.Context, numWorkers int) {
	for i := 0; i < numWorkers; i++ {
		go func(workerID int) {
			slog.Info("Starting background indexing worker", "id", workerID)
			for {
				select {
				case <-ctx.Done():
					slog.Info("Stopping indexing worker", "id", workerID)
					return
				case repoID := <-w.jobQueue:
					slog.Info("Worker picked up indexing job", "worker_id", workerID, "repo_id", repoID)
					if err := w.IndexRepository(repoID); err != nil {
						slog.Error("Failed indexing repository", "repo_id", repoID, "error", err)
					}
				}
			}
		}(i)
	}
}

func (w *Worker) Enqueue(repoID uint) {
	w.jobQueue <- repoID
}

type FileChunk struct {
	Content   string
	StartLine int
	EndLine   int
}

func (w *Worker) IndexRepository(repoID uint) error {
	ctx := context.Background()

	// 1. Fetch Repository from Database
	var repo models.Repository
	if err := w.db.First(&repo, repoID).Error; err != nil {
		return err
	}

	// Update status to indexing
	w.db.Model(&repo).Update("status", "indexing")

	slog.Info("Downloading repository ZIP", "owner", repo.Owner, "repo", repo.Name, "branch", repo.DefaultBranch)
	zipBytes, err := w.githubClient.DownloadZip(repo.Owner, repo.Name, repo.DefaultBranch)
	if err != nil {
		w.markAsFailed(repo, fmt.Errorf("failed downloading repository zip: %w", err))
		return err
	}

	slog.Info("Extracting and parsing repository files")
	files, err := github.ExtractFiles(zipBytes)
	if err != nil {
		w.markAsFailed(repo, fmt.Errorf("failed extracting repository files: %w", err))
		return err
	}

	slog.Info("Repository extraction completed", "files_found", len(files))

	// Ensure Qdrant collection is created
	collectionName := "github_repo_chunks"
	if err := w.vectorClient.InitCollection(collectionName, w.aiService.GetVectorDimension()); err != nil {
		w.markAsFailed(repo, fmt.Errorf("failed initializing vector collection: %w", err))
		return err
	}

	// Delete old vectors if any exist for this repository (re-indexing safety)
	if err := w.vectorClient.DeletePointsByRepo(collectionName, repo.ID); err != nil {
		slog.Warn("Failed deleting old vectors (ignoring)", "repo_id", repo.ID, "error", err)
	}

	var points []vector.Point
	totalChunks := 0

	for _, file := range files {
		// Group lines: chunk size 30 lines, overlap 8 lines
		chunks := splitFileIntoChunks(file.Content, 30, 8)

		for _, chunk := range chunks {
			// Generate embedding
			embedding, err := w.aiService.GetEmbedding(ctx, fmt.Sprintf("File: %s\n%s", file.Path, chunk.Content))
			if err != nil {
				w.markAsFailed(repo, fmt.Errorf("failed generating embedding: %w", err))
				return err
			}

			pt := vector.Point{
				ID:     uuid.New().String(),
				Vector: embedding,
				Payload: vector.ChunkPayload{
					RepositoryID: repo.ID,
					FilePath:     file.Path,
					Content:      chunk.Content,
					StartLine:    chunk.StartLine,
					EndLine:      chunk.EndLine,
				},
			}
			points = append(points, pt)
			totalChunks++

			// Upload in batches of 50
			if len(points) >= 50 {
				slog.Info("Uploading vector batch to Qdrant", "batch_size", len(points), "total_chunks", totalChunks)
				if err := w.vectorClient.UpsertPoints(collectionName, points); err != nil {
					w.markAsFailed(repo, fmt.Errorf("failed upserting vectors to qdrant: %w", err))
					return err
				}
				points = nil // Clear slice
			}
		}
	}

	// Upload remaining points
	if len(points) > 0 {
		slog.Info("Uploading final vector batch to Qdrant", "batch_size", len(points), "total_chunks", totalChunks)
		if err := w.vectorClient.UpsertPoints(collectionName, points); err != nil {
			w.markAsFailed(repo, fmt.Errorf("failed upserting remaining vectors: %w", err))
			return err
		}
	}

	// 5. Update Repository Status to indexed
	w.db.Model(&repo).Updates(map[string]interface{}{
		"status":        "indexed",
		"chunk_count":   totalChunks,
		"error_message": "",
	})

	slog.Info("Indexing completed successfully", "repo_id", repo.ID, "chunks", totalChunks)
	return nil
}

func (w *Worker) markAsFailed(repo models.Repository, err error) {
	slog.Error("Indexing job failed", "repo_id", repo.ID, "error", err)
	w.db.Model(&repo).Updates(map[string]interface{}{
		"status":        "failed",
		"error_message": err.Error(),
	})
}

// splitFileIntoChunks divides file content into chunks based on lines
func splitFileIntoChunks(content string, chunkSizeLines int, overlapLines int) []FileChunk {
	lines := strings.Split(content, "\n")
	var chunks []FileChunk
	if len(lines) == 0 {
		return chunks
	}

	for i := 0; i < len(lines); i += (chunkSizeLines - overlapLines) {
		end := i + chunkSizeLines
		if end > len(lines) {
			end = len(lines)
		}

		chunkLines := lines[i:end]
		chunkContent := strings.Join(chunkLines, "\n")

		chunks = append(chunks, FileChunk{
			Content:   chunkContent,
			StartLine: i + 1,
			EndLine:   end,
		})

		if end == len(lines) {
			break
		}
	}
	return chunks
}
