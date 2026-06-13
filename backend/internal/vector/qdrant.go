package vector

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type QdrantClient struct {
	baseURL string
	client  *http.Client
}

type ChunkPayload struct {
	RepositoryID uint   `json:"repository_id"`
	FilePath     string `json:"file_path"`
	Content      string `json:"content"`
	StartLine    int    `json:"start_line"`
	EndLine      int    `json:"end_line"`
}

type Point struct {
	ID      string       `json:"id"`
	Vector  []float32    `json:"vector"`
	Payload ChunkPayload `json:"payload"`
}

type SearchResult struct {
	ID      interface{}  `json:"id"`
	Score   float32      `json:"score"`
	Payload ChunkPayload `json:"payload"`
}

func NewQdrantClient(host, port string) *QdrantClient {
	return &QdrantClient{
		baseURL: fmt.Sprintf("http://%s:%s", host, port),
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

// InitCollection ensures the target collection exists in Qdrant and matches dimensions
func (q *QdrantClient) InitCollection(collectionName string, vectorSize int) error {
	checkURL := fmt.Sprintf("%s/collections/%s", q.baseURL, collectionName)
	req, err := http.NewRequest("GET", checkURL, nil)
	if err != nil {
		return err
	}

	resp, err := q.client.Do(req)
	if err == nil && resp.StatusCode == http.StatusOK {
		defer resp.Body.Close()
		
		// Parse collection details to verify dimension matches
		var colInfo struct {
			Result struct {
				Config struct {
					Params struct {
						Vectors struct {
							Size int `json:"size"`
						} `json:"vectors"`
					} `json:"params"`
				} `json:"config"`
			} `json:"result"`
		}
		
		if err := json.NewDecoder(resp.Body).Decode(&colInfo); err == nil {
			existingSize := colInfo.Result.Config.Params.Vectors.Size
			if existingSize == vectorSize {
				slog.Info("Qdrant collection already exists with correct dimensions", "collection", collectionName, "size", vectorSize)
				return nil
			}
			
			slog.Warn("Qdrant collection dimension mismatch. Recreating collection.", "collection", collectionName, "existing", existingSize, "new", vectorSize)
			
			// Delete existing collection
			delURL := fmt.Sprintf("%s/collections/%s", q.baseURL, collectionName)
			delReq, err := http.NewRequest("DELETE", delURL, nil)
			if err == nil {
				if delResp, err := q.client.Do(delReq); err == nil {
					delResp.Body.Close()
				}
			}
		}
	} else if resp != nil {
		resp.Body.Close()
	}

	slog.Info("Creating Qdrant collection...", "collection", collectionName, "size", vectorSize)
	createURL := fmt.Sprintf("%s/collections/%s", q.baseURL, collectionName)
	reqBody, err := json.Marshal(map[string]interface{}{
		"vectors": map[string]interface{}{
			"size":     vectorSize,
			"distance": "Cosine",
		},
	})
	if err != nil {
		return err
	}

	req, err = http.NewRequest("PUT", createURL, bytes.NewBuffer(reqBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err = q.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed creating qdrant collection, status %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	slog.Info("Qdrant collection created successfully.")
	return nil
}

// UpsertPoints pushes embeddings and metadata payloads into Qdrant
func (q *QdrantClient) UpsertPoints(collectionName string, points []Point) error {
	if len(points) == 0 {
		return nil
	}

	// Format UUIDs for Qdrant (points must have standard UUID or integer ID)
	qdrantPoints := make([]map[string]interface{}, len(points))
	for i, pt := range points {
		idStr := pt.ID
		if idStr == "" {
			idStr = uuid.New().String()
		}
		qdrantPoints[i] = map[string]interface{}{
			"id":      idStr,
			"vector":  pt.Vector,
			"payload": pt.Payload,
		}
	}

	reqBody, err := json.Marshal(map[string]interface{}{
		"points": qdrantPoints,
	})
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/collections/%s/points?wait=true", q.baseURL, collectionName)
	req, err := http.NewRequest("PUT", url, bytes.NewBuffer(reqBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := q.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed upserting points to qdrant, status %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	return nil
}

// Search similarity search filtered by Repository ID
func (q *QdrantClient) Search(collectionName string, vector []float32, repoID uint, limit int) ([]SearchResult, error) {
	searchURL := fmt.Sprintf("%s/collections/%s/points/search", q.baseURL, collectionName)

	reqBody, err := json.Marshal(map[string]interface{}{
		"vector": vector,
		"limit":  limit,
		"filter": map[string]interface{}{
			"must": []map[string]interface{}{
				{
					"key": "repository_id",
					"match": map[string]interface{}{
						"value": repoID,
					},
				},
			},
		},
		"with_payload": true,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", searchURL, bytes.NewBuffer(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := q.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed searching qdrant, status %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	var searchResp struct {
		Result []SearchResult `json:"result"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&searchResp); err != nil {
		return nil, err
	}

	return searchResp.Result, nil
}

// DeletePointsByRepo deletes all embeddings belonging to a repository
func (q *QdrantClient) DeletePointsByRepo(collectionName string, repoID uint) error {
	deleteURL := fmt.Sprintf("%s/collections/%s/points/delete", q.baseURL, collectionName)

	reqBody, err := json.Marshal(map[string]interface{}{
		"filter": map[string]interface{}{
			"must": []map[string]interface{}{
				{
					"key": "repository_id",
					"match": map[string]interface{}{
						"value": repoID,
					},
				},
			},
		},
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", deleteURL, bytes.NewBuffer(reqBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := q.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed deleting points in qdrant, status %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	return nil
}
